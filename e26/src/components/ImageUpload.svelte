<script>
  export let imagePreview = null;
  export let imageDimensions = null;
  export let error = null;

  let isDragging = false;

  function handleDragOver(e) {
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave() {
    isDragging = false;
  }

  function handleDrop(e) {
    e.preventDefault();
    isDragging = false;
    const file = e.dataTransfer.files[0];
    if (file) {
      processFile(file);
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      processFile(file);
    }
  }

  function processFile(file) {
    if (!file.type.startsWith('image/')) {
      error = '请上传图片文件';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        imageDimensions = { width: img.width, height: img.height };
        imagePreview = e.target.result;
        error = null;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function clearImage() {
    imagePreview = null;
    imageDimensions = null;
  }
</script>

<div class="w-full animate-fade-in">
  <div
    class="relative border-2 border-dashed rounded-xl p-8 transition-all duration-300 cursor-pointer {isDragging
      ? 'border-primary-400 bg-primary-900/30'
      : 'border-gray-600 hover:border-primary-500 bg-slate-800/50'}"
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
    on:click={() => document.getElementById('fileInput').click()}
  >
    <input
      id="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      on:change={handleFileSelect}
    />

    {#if imagePreview}
      <div class="flex flex-col items-center">
        <img
          src={imagePreview}
          alt="Preview"
          class="max-w-full max-h-64 object-contain rounded-lg mb-4"
        />
        {#if imageDimensions}
          <p class="text-sm text-gray-400 mb-3">
            {imageDimensions.width} x {imageDimensions.height} 像素
          </p>
        {/if}
        <button
          on:click|stopPropagation={clearImage}
          class="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors text-sm font-medium"
        >
          移除图片
        </button>
      </div>
    {:else}
      <div class="flex flex-col items-center text-center">
        <div class="w-16 h-16 mb-4 rounded-full bg-primary-500/20 flex items-center justify-center">
          <svg class="w-8 h-8 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p class="text-lg font-medium text-white mb-2">
          点击或拖拽上传图片
        </p>
        <p class="text-sm text-gray-400">
          支持 PNG、JPG、GIF 等格式
        </p>
      </div>
    {/if}
  </div>
</div>
