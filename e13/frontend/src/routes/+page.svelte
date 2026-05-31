<script>
    import { onMount } from 'svelte';

    let wasm;
    let imageUpload;
    let canvas;
    let ctx;
    let originalImageData;
    let imageLoaded = false;
    let processor = null;
    let uploading = false;
    let uploadResult = null;
    let uploadError = null;

    const SERVER_URL = 'http://localhost:3000';

    onMount(async () => {
        wasm = await import('../../wasm/pkg/wasm_image_processor.js');
        await wasm.default();
    });

    function handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        uploadResult = null;
        uploadError = null;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                
                processor = new wasm.ImageProcessor(canvas.width, canvas.height);
                
                imageLoaded = true;
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function applyGrayscale() {
        if (!imageLoaded || !processor) return;
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        processor.load_from_js(imageData.data);
        processor.grayscale();
        processor.copy_to_js(imageData.data);
        
        ctx.putImageData(imageData, 0, 0);
        uploadResult = null;
    }

    function applyInvert() {
        if (!imageLoaded || !processor) return;
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        processor.load_from_js(imageData.data);
        processor.invert();
        processor.copy_to_js(imageData.data);
        
        ctx.putImageData(imageData, 0, 0);
        uploadResult = null;
    }

    function resetImage() {
        if (!originalImageData) return;
        ctx.putImageData(originalImageData, 0, 0);
        uploadResult = null;
    }

    async function uploadToServer() {
        if (!imageLoaded || uploading) return;

        uploading = true;
        uploadError = null;
        uploadResult = null;

        try {
            const blob = await new Promise((resolve) => {
                canvas.toBlob(resolve, 'image/png');
            });

            const formData = new FormData();
            formData.append('image', blob, 'processed-image.png');

            const response = await fetch(`${SERVER_URL}/api/upload`, {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                uploadResult = result;
            } else {
                uploadError = result.error || '上传失败';
            }
        } catch (error) {
            uploadError = '网络错误：' + error.message;
        } finally {
            uploading = false;
        }
    }
</script>

<div class="container">
    <h1>WebAssembly 图像处理</h1>
    
    <div class="upload-section">
        <label for="imageUpload" class="upload-btn">选择图片</label>
        <input
            id="imageUpload"
            bind:this={imageUpload}
            type="file"
            accept="image/*"
            on:change={handleImageUpload}
            style="display: none;"
        />
    </div>

    <div class="canvas-container">
        <canvas bind:this={canvas}></canvas>
    </div>

    {#if imageLoaded}
        <div class="controls">
            <button on:click={applyGrayscale} class="filter-btn">灰度化</button>
            <button on:click={applyInvert} class="filter-btn">反色</button>
            <button on:click={resetImage} class="reset-btn">重置</button>
            <button on:click={uploadToServer} class="upload-btn" disabled={uploading}>
                {uploading ? '上传中...' : '保存到服务器'}
            </button>
        </div>

        {#if uploadResult}
            <div class="success-message">
                <h3>✅ 上传成功！</h3>
                <p>文件名：{uploadResult.filename}</p>
                <p>大小：{(uploadResult.size / 1024).toFixed(2)} KB</p>
                <a href={uploadResult.url} target="_blank" class="image-link">
                    点击查看图片
                </a>
            </div>
        {/if}

        {#if uploadError}
            <div class="error-message">
                <h3>❌ 上传失败</h3>
                <p>{uploadError}</p>
            </div>
        {/if}
    {/if}
</div>

<style>
    .container {
        max-width: 800px;
        margin: 0 auto;
        padding: 2rem;
        text-align: center;
    }

    h1 {
        color: #333;
        margin-bottom: 2rem;
    }

    .upload-section {
        margin-bottom: 2rem;
    }

    .upload-btn {
        display: inline-block;
        padding: 0.75rem 1.5rem;
        background: #4a69bd;
        color: white;
        border-radius: 8px;
        cursor: pointer;
        font-size: 1rem;
        transition: background 0.3s;
    }

    .upload-btn:hover {
        background: #3c55a5;
    }

    .canvas-container {
        margin: 2rem 0;
        min-height: 300px;
        display: flex;
        justify-content: center;
        align-items: center;
        border: 2px dashed #ccc;
        border-radius: 8px;
        background: #f9f9f9;
    }

    canvas {
        max-width: 100%;
        height: auto;
        display: block;
    }

    .controls {
        display: flex;
        gap: 1rem;
        justify-content: center;
        flex-wrap: wrap;
    }

    .filter-btn, .reset-btn {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        cursor: pointer;
        transition: all 0.3s;
    }

    .filter-btn {
        background: #00b894;
        color: white;
    }

    .filter-btn:hover {
        background: #00a884;
    }

    .reset-btn {
        background: #e17055;
        color: white;
    }

    .reset-btn:hover {
        background: #d16045;
    }

    .upload-btn {
        background: #6c5ce7;
        color: white;
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        cursor: pointer;
        transition: all 0.3s;
    }

    .upload-btn:hover:not(:disabled) {
        background: #5b4cdb;
    }

    .upload-btn:disabled {
        background: #b2bec3;
        cursor: not-allowed;
    }

    .success-message {
        background: linear-gradient(135deg, #00b894, #00cec9);
        color: white;
        padding: 1.5rem;
        border-radius: 12px;
        margin-top: 1.5rem;
        text-align: center;
        box-shadow: 0 4px 15px rgba(0, 184, 148, 0.3);
    }

    .success-message h3 {
        margin: 0 0 0.75rem 0;
        font-size: 1.25rem;
    }

    .success-message p {
        margin: 0.5rem 0;
        font-size: 0.95rem;
    }

    .image-link {
        display: inline-block;
        margin-top: 0.75rem;
        padding: 0.5rem 1.25rem;
        background: white;
        color: #00b894;
        text-decoration: none;
        border-radius: 6px;
        font-weight: 600;
        transition: all 0.3s;
    }

    .image-link:hover {
        background: #f0f0f0;
        transform: translateY(-2px);
    }

    .error-message {
        background: linear-gradient(135deg, #e17055, #d63031);
        color: white;
        padding: 1.5rem;
        border-radius: 12px;
        margin-top: 1.5rem;
        text-align: center;
        box-shadow: 0 4px 15px rgba(225, 112, 85, 0.3);
    }

    .error-message h3 {
        margin: 0 0 0.75rem 0;
        font-size: 1.25rem;
    }

    .error-message p {
        margin: 0;
        font-size: 0.95rem;
    }
</style>
