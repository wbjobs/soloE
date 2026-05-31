<script>
  export let processedImage = null;
  export let decodedMessage = null;
  export let error = null;

  function downloadImage() {
    if (!processedImage) return;
    
    const link = document.createElement('a');
    link.href = processedImage;
    link.download = 'steganography-image.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function copyToClipboard() {
    if (!decodedMessage) return;
    
    navigator.clipboard.writeText(decodedMessage);
  }
</script>

{#if error}
  <div class="w-full p-4 bg-red-500/20 border border-red-500/30 rounded-xl animate-fade-in">
    <div class="flex items-start gap-3">
      <svg class="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-red-400">{error}</p>
    </div>
  </div>
{/if}

{#if processedImage}
  <div class="w-full animate-fade-in">
    <div class="gradient-border">
      <div class="gradient-border-inner p-6">
        <h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <svg class="w-5 h-5 text-success-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          编码成功！
        </h3>
        <div class="flex flex-col items-center">
          <img
            src={processedImage}
            alt="Processed"
            class="max-w-full max-h-64 object-contain rounded-lg mb-4 border border-gray-700"
          />
          <p class="text-sm text-gray-400 mb-4">
            文本已成功隐藏到图片中
          </p>
          <button
            on:click={downloadImage}
            class="px-6 py-2 bg-success-500 text-white font-medium rounded-lg hover:bg-success-600 transition-colors flex items-center gap-2"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            下载图片
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if decodedMessage}
  <div class="w-full animate-fade-in">
    <div class="gradient-border">
      <div class="gradient-border-inner p-6">
        <h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <svg class="w-5 h-5 text-success-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          解码成功！
        </h3>
        <div class="bg-slate-900/50 rounded-lg p-4 mb-4">
          <p class="text-gray-200 whitespace-pre-wrap break-all">
            {decodedMessage}
          </p>
        </div>
        <button
          on:click={copyToClipboard}
          class="px-6 py-2 bg-primary-500 text-white font-medium rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-2"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          复制文本
        </button>
      </div>
    </div>
  </div>
{/if}
