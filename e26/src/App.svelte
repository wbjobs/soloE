<script>
  import ImageUpload from './components/ImageUpload.svelte';
  import TextInput from './components/TextInput.svelte';
  import ActionButtons from './components/ActionButtons.svelte';
  import ResultDisplay from './components/ResultDisplay.svelte';
  import { getMaxMessageSize, encodeMessage, decodeMessage } from './utils/steganography.js';

  let imagePreview = null;
  let imageDimensions = null;
  let message = '';
  let decodedMessage = null;
  let processedImage = null;
  let isProcessing = false;
  let processingProgress = 0;
  let error = null;
  let currentOperation = null;

  let worker = null;
  let workerBlobUrl = null;

  function initWorker() {
    if (worker) {
      worker.terminate();
    }
    if (workerBlobUrl) {
      URL.revokeObjectURL(workerBlobUrl);
    }

    const workerCode = `
      const MAGIC_NUMBER = new Uint8Array([0x53, 0x54, 0x45, 0x47]);
      const MAGIC_LENGTH = MAGIC_NUMBER.length;
      const LENGTH_FIELD_SIZE = 4;
      const CHECKSUM_SIZE = 4;
      const HEADER_SIZE = MAGIC_LENGTH + LENGTH_FIELD_SIZE + CHECKSUM_SIZE;

      function calculateChecksum(data) {
        let checksum = 0;
        for (let i = 0; i < data.length; i++) {
          checksum = ((checksum << 5) - checksum + data[i]) | 0;
        }
        return checksum >>> 0;
      }

      function writeBitToPixel(pixels, bitIndex, bitValue) {
        const pixelIndex = bitIndex * 4;
        pixels[pixelIndex + 2] = (pixels[pixelIndex + 2] & 0xFE) | bitValue;
      }

      function readBitFromPixel(pixels, bitIndex) {
        const pixelIndex = bitIndex * 4;
        return pixels[pixelIndex + 2] & 1;
      }

      function writeBytes(pixels, startBitIndex, bytes, onProgress) {
        let bitIndex = startBitIndex;
        for (const byte of bytes) {
          for (let bit = 0; bit < 8; bit++) {
            const bitValue = (byte >> (7 - bit)) & 1;
            writeBitToPixel(pixels, bitIndex, bitValue);
            bitIndex++;
            if (onProgress) onProgress(bitIndex);
          }
        }
        return bitIndex;
      }

      function readBytes(pixels, startBitIndex, length) {
        const bytes = new Uint8Array(length);
        let bitIndex = startBitIndex;
        for (let i = 0; i < length; i++) {
          for (let bit = 0; bit < 8; bit++) {
            const bitValue = readBitFromPixel(pixels, bitIndex);
            bytes[i] = (bytes[i] << 1) | bitValue;
            bitIndex++;
          }
        }
        return { bytes, nextBitIndex: bitIndex };
      }

      function encodeMessage(pixels, width, height, message, onProgress) {
        const encoder = new TextEncoder();
        const messageBytes = encoder.encode(message);
        const messageLen = messageBytes.length;

        const maxBytes = Math.floor((width * height) / 8);
        if (messageLen + HEADER_SIZE > maxBytes) {
          throw new Error(\`Message too long. Max: \${maxBytes - HEADER_SIZE} bytes, got: \${messageLen} bytes\`);
        }

        const checksum = calculateChecksum(messageBytes);

        const lenBytes = new Uint8Array(4);
        new DataView(lenBytes.buffer).setUint32(0, messageLen, false);

        const checksumBytes = new Uint8Array(4);
        new DataView(checksumBytes.buffer).setUint32(0, checksum, false);

        let bitIndex = 0;

        bitIndex = writeBytes(pixels, bitIndex, MAGIC_NUMBER, onProgress);
        bitIndex = writeBytes(pixels, bitIndex, lenBytes, onProgress);
        bitIndex = writeBytes(pixels, bitIndex, checksumBytes, onProgress);
        writeBytes(pixels, bitIndex, messageBytes, onProgress);

        return pixels;
      }

      function decodeMessage(pixels, width, height) {
        let bitIndex = 0;

        const { bytes: magicBytes, nextBitIndex: afterMagic } = readBytes(pixels, bitIndex, MAGIC_LENGTH);
        bitIndex = afterMagic;

        for (let i = 0; i < MAGIC_LENGTH; i++) {
          if (magicBytes[i] !== MAGIC_NUMBER[i]) {
            throw new Error('No hidden message found: invalid magic number');
          }
        }

        const { bytes: lenBytes, nextBitIndex: afterLen } = readBytes(pixels, bitIndex, LENGTH_FIELD_SIZE);
        bitIndex = afterLen;

        const messageLen = new DataView(lenBytes.buffer).getUint32(0, false);

        const maxBytes = Math.floor((width * height) / 8) - HEADER_SIZE;
        if (messageLen > maxBytes || messageLen === 0) {
          throw new Error('No hidden message found or message corrupted');
        }

        const { bytes: checksumBytes, nextBitIndex: afterChecksum } = readBytes(pixels, bitIndex, CHECKSUM_SIZE);
        bitIndex = afterChecksum;

        const expectedChecksum = new DataView(checksumBytes.buffer).getUint32(0, false);

        const { bytes: messageBytes } = readBytes(pixels, bitIndex, messageLen);

        const actualChecksum = calculateChecksum(messageBytes);
        if (actualChecksum !== expectedChecksum) {
          throw new Error('Message corrupted: checksum mismatch');
        }

        const decoder = new TextDecoder();
        return decoder.decode(messageBytes);
      }

      self.onmessage = function(e) {
        const { type, pixels, width, height, message } = e.data;

        try {
          if (type === 'encode') {
            const totalBits = (message.length + 12) * 8;
            const progressInterval = Math.max(1, Math.floor(totalBits / 20));
            let lastReportedProgress = 0;

            const pixelArray = new Uint8Array(pixels);
            const result = encodeMessage(pixelArray, width, height, message, (current) => {
              if (current % progressInterval === 0) {
                const progress = Math.min(100, Math.floor((current / totalBits) * 100));
                if (progress !== lastReportedProgress) {
                  lastReportedProgress = progress;
                  self.postMessage({ type: 'progress', progress });
                }
              }
            });

            self.postMessage({ type: 'encode-complete', pixels: Array.from(result) });
          } else if (type === 'decode') {
            const pixelArray = new Uint8Array(pixels);
            const result = decodeMessage(pixelArray, width, height);
            self.postMessage({ type: 'decode-complete', message: result });
          }
        } catch (error) {
          self.postMessage({ type: 'error', message: error.message });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    workerBlobUrl = URL.createObjectURL(blob);
    worker = new Worker(workerBlobUrl);
    
    worker.onmessage = function(e) {
      const { type, progress, pixels, message: resultMessage } = e.data;
      
      if (type === 'progress') {
        processingProgress = progress;
      } else if (type === 'encode-complete') {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = imageDimensions.width;
        canvas.height = imageDimensions.height;
        const imageData = new ImageData(
          new Uint8ClampedArray(pixels),
          imageDimensions.width,
          imageDimensions.height
        );
        ctx.putImageData(imageData, 0, 0);
        processedImage = canvas.toDataURL('image/png');
        isProcessing = false;
        processingProgress = 0;
        currentOperation = null;
      } else if (type === 'decode-complete') {
        decodedMessage = resultMessage;
        isProcessing = false;
        processingProgress = 0;
        currentOperation = null;
      } else if (type === 'error') {
        error = e.data.message;
        isProcessing = false;
        processingProgress = 0;
        currentOperation = null;
      }
    };

    worker.onerror = function(e) {
      error = e.message;
      isProcessing = false;
      processingProgress = 0;
      currentOperation = null;
    };
  }

  $: maxLength = imageDimensions ? getMaxMessageSize(imageDimensions.width, imageDimensions.height) : 0;

  function getImageData() {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ imageData, canvas, ctx });
      };

      img.src = imagePreview;
    });
  }

  async function handleEncode() {
    if (!imagePreview || !message) return;

    isProcessing = true;
    processingProgress = 0;
    currentOperation = 'encode';
    error = null;
    processedImage = null;
    decodedMessage = null;

    initWorker();

    try {
      const { imageData } = await getImageData();
      const pixels = Array.from(imageData.data);

      worker.postMessage({
        type: 'encode',
        pixels,
        width: imageDimensions.width,
        height: imageDimensions.height,
        message
      });
    } catch (e) {
      error = e.message;
      isProcessing = false;
      processingProgress = 0;
    }
  }

  async function handleDecode() {
    if (!imagePreview) return;

    isProcessing = true;
    processingProgress = 0;
    currentOperation = 'decode';
    error = null;
    processedImage = null;
    decodedMessage = null;

    initWorker();

    try {
      const { imageData } = await getImageData();
      const pixels = Array.from(imageData.data);

      worker.postMessage({
        type: 'decode',
        pixels,
        width: imageDimensions.width,
        height: imageDimensions.height
      });
    } catch (e) {
      error = e.message;
      isProcessing = false;
      processingProgress = 0;
    }
  }
</script>

<div class="min-h-screen py-8 px-4">
  <div class="max-w-3xl mx-auto">
    <header class="text-center mb-10 animate-fade-in">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-success-500 mb-4 shadow-lg">
        <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      </div>
      <h1 class="text-3xl font-bold text-white mb-2">
        图片隐写工具
      </h1>
      <p class="text-gray-400 max-w-md mx-auto">
        使用最低有效位（LSB）算法，将文本信息隐藏到图片的蓝色通道中
      </p>
    </header>

    <div class="space-y-6">
      <ImageUpload
        bind:imagePreview
        bind:imageDimensions
        bind:error
      />

      <TextInput
        bind:message
        maxLength={maxLength}
        disabled={isProcessing}
      />

      <ActionButtons
        {isProcessing}
        hasImage={!!imagePreview}
        hasMessage={message.length > 0}
        onEncode={handleEncode}
        onDecode={handleDecode}
      />

      {#if isProcessing}
        <div class="w-full bg-slate-800/50 rounded-xl p-6 animate-fade-in">
          <div class="flex items-center justify-between mb-3">
            <span class="text-white font-medium">
              {currentOperation === 'encode' ? '正在编码...' : '正在解码...'}
            </span>
            <span class="text-primary-400 font-medium">{processingProgress}%</span>
          </div>
          <div class="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-primary-500 to-success-500 rounded-full transition-all duration-300 ease-out"
              style="width: {processingProgress}%"
            />
          </div>
          <p class="text-xs text-gray-500 mt-3 text-center">
            在后台线程中处理，不会阻塞页面
          </p>
        </div>
      {/if}

      <ResultDisplay
        {processedImage}
        {decodedMessage}
        {error}
      />
    </div>

    <footer class="mt-12 text-center animate-fade-in" style="animation-delay: 0.3s">
      <div class="bg-slate-800/50 rounded-xl p-6">
        <h3 class="text-lg font-semibold text-white mb-3">使用说明</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-400">
          <div class="flex items-start gap-3">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-xs font-bold">1</span>
            <p class="text-left">上传一张图片作为隐写载体</p>
          </div>
          <div class="flex items-start gap-3">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center text-xs font-bold">2</span>
            <p class="text-left">输入要隐藏的文本信息</p>
          </div>
          <div class="flex items-start gap-3">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-success-500/20 text-success-400 flex items-center justify-center text-xs font-bold">3</span>
            <p class="text-left">点击"编码隐藏"生成带隐藏信息的图片</p>
          </div>
          <div class="flex items-start gap-3">
            <span class="flex-shrink-0 w-6 h-6 rounded-full bg-success-500/20 text-success-400 flex items-center justify-center text-xs font-bold">4</span>
            <p class="text-left">上传带隐藏信息的图片，点击"解码提取"查看内容</p>
          </div>
        </div>
        <p class="mt-4 text-xs text-gray-500">
          提示：图片越大，可隐藏的文本内容越多。所有处理均在浏览器本地完成，不会上传到服务器。
        </p>
      </div>
    </footer>
  </div>
</div>
