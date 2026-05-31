import * as ort from 'onnxruntime-web';

const MODEL_URL = 'https://github.com/nicolalandro/onnx-models/releases/download/v1.0/pphumanseg_lite_192x192.onnx';

let session: ort.InferenceSession | null = null;
const TARGET_WIDTH = 192;
const TARGET_HEIGHT = 192;

async function loadModel(): Promise<void> {
  if (session) return;

  try {
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
    ort.env.wasm.simd = true;
    
    self.postMessage({ type: 'progress', payload: 0.2 });

    const response = await fetch(MODEL_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch model: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    self.postMessage({ type: 'progress', payload: 0.5 });

    session = await ort.InferenceSession.create(arrayBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    self.postMessage({ type: 'progress', payload: 1.0 });
    self.postMessage({ type: 'loaded' });
  } catch (error) {
    self.postMessage({
      type: 'error',
      payload: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

function preprocess(imageData: ImageData): Float32Array {
  const { width, height, data } = imageData;
  const result = new Float32Array(3 * width * height);

  for (let i = 0; i < width * height; i++) {
    const pixelIdx = i * 4;
    const r = data[pixelIdx] / 255;
    const g = data[pixelIdx + 1] / 255;
    const b = data[pixelIdx + 2] / 255;

    result[i] = (r - 0.485) / 0.229;
    result[i + width * height] = (g - 0.456) / 0.224;
    result[i + 2 * width * height] = (b - 0.406) / 0.225;
  }

  return result;
}

function postprocess(output: ort.Tensor, originalWidth: number, originalHeight: number): Uint8ClampedArray {
  const data = output.data as Float32Array;
  const result = new Uint8ClampedArray(originalWidth * originalHeight * 4);

  const outputWidth = output.dims[3];
  const outputHeight = output.dims[2];

  for (let y = 0; y < originalHeight; y++) {
    for (let x = 0; x < originalWidth; x++) {
      const srcX = Math.floor((x / originalWidth) * outputWidth);
      const srcY = Math.floor((y / originalHeight) * outputHeight);
      const srcIdx = srcY * outputWidth + srcX;
      
      let alpha = data[srcIdx];
      if (data.length > outputWidth * outputHeight) {
        alpha = data[outputWidth * outputHeight + srcIdx];
      }
      
      alpha = Math.max(0, Math.min(1, alpha));

      const dstIdx = (y * originalWidth + x) * 4;
      const value = Math.round(alpha * 255);
      result[dstIdx] = value;
      result[dstIdx + 1] = value;
      result[dstIdx + 2] = value;
      result[dstIdx + 3] = 255;
    }
  }

  return result;
}

async function segment(imageData: ImageData, originalWidth: number, originalHeight: number): Promise<void> {
  if (!session) {
    self.postMessage({ type: 'error', payload: 'Model not loaded' });
    return;
  }

  let inputTensor: ort.Tensor | null = null;
  let output: ort.InferenceSession.OnnxValueMapType | null = null;

  try {
    const startTime = performance.now();
    
    const input = preprocess(imageData);
    inputTensor = new ort.Tensor('float32', input, [1, 3, TARGET_HEIGHT, TARGET_WIDTH]);

    output = await session.run({ input: inputTensor });
    
    const outputTensor = Object.values(output)[0];
    const alphaData = postprocess(outputTensor, originalWidth, originalHeight);
    
    const inferenceTime = performance.now() - startTime;

    self.postMessage({
      type: 'result',
      payload: {
        alphaData: alphaData.buffer,
        dimensions: { width: originalWidth, height: originalHeight },
        inferenceTime,
      },
    }, { transfer: [alphaData.buffer] });
  } catch (error) {
    self.postMessage({
      type: 'error',
      payload: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    if (inputTensor) {
      try {
        inputTensor.dispose();
      } catch (e) {
        console.warn('Failed to dispose input tensor:', e);
      }
      inputTensor = null;
    }

    if (output) {
      try {
        Object.values(output).forEach(tensor => {
          if (tensor && typeof tensor.dispose === 'function') {
            tensor.dispose();
          }
        });
      } catch (e) {
        console.warn('Failed to dispose output tensors:', e);
      }
      output = null;
    }
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'load':
      await loadModel();
      break;
    case 'segment':
      const { imageData, originalWidth, originalHeight } = payload;
      const uint8Array = new Uint8ClampedArray(imageData);
      const imgData = new ImageData(uint8Array, TARGET_WIDTH, TARGET_HEIGHT);
      await segment(imgData, originalWidth, originalHeight);
      break;
    case 'cancel':
      break;
  }
};
