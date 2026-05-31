<script>
  import { createEventDispatcher } from 'svelte'

  const dispatch = createEventDispatcher()

  let fileOld = null
  let fileNew = null

  const handleDropOld = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.csv')) {
      fileOld = file
    }
  }

  const handleChangeOld = (e) => {
    const file = e.target.files[0]
    if (file) {
      fileOld = file
    }
  }

  const handleDropNew = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.csv')) {
      fileNew = file
    }
  }

  const handleChangeNew = (e) => {
    const file = e.target.files[0]
    if (file) {
      fileNew = file
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
  }

  const handleSubmit = () => {
    if (fileOld && fileNew) {
      dispatch('upload', fileOld, fileNew)
    }
  }
</script>

<div class="comparison-upload">
  <div class="upload-pair">
    <div 
      class="upload-box {fileOld ? 'has-file' : ''}"
      on:drop={handleDropOld}
      on:dragover={handleDragOver}
    >
      <div class="upload-icon">📄</div>
      <p class="upload-label">旧版数据（基线）</p>
      {#if fileOld}
        <p class="file-name">{fileOld.name}</p>
      {:else}
        <p class="upload-text">拖拽或选择旧版 CSV 文件</p>
      {/if}
      <input 
        type="file" 
        accept=".csv" 
        class="file-input"
        id="file-old"
        on:change={handleChangeOld}
      />
      <label class="upload-button" for="file-old">
        {fileOld ? '重新选择' : '选择文件'}
      </label>
    </div>

    <div class="vs-badge">VS</div>

    <div 
      class="upload-box {fileNew ? 'has-file' : ''}"
      on:drop={handleDropNew}
      on:dragover={handleDragOver}
    >
      <div class="upload-icon">📄</div>
      <p class="upload-label">新版数据</p>
      {#if fileNew}
        <p class="file-name">{fileNew.name}</p>
      {:else}
        <p class="upload-text">拖拽或选择新版 CSV 文件</p>
      {/if}
      <input 
        type="file" 
        accept=".csv" 
        class="file-input"
        id="file-new"
        on:change={handleChangeNew}
      />
      <label class="upload-button" for="file-new">
        {fileNew ? '重新选择' : '选择文件'}
      </label>
    </div>
  </div>

  <div class="submit-container">
    <button 
      class="submit-btn"
      on:click={handleSubmit}
      disabled={!fileOld || !fileNew}
    >
      🔄 开始对比分析
    </button>
  </div>
</div>

<style>
  .comparison-upload {
    margin-bottom: 30px;
  }

  .upload-pair {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 20px;
    align-items: center;
  }

  .upload-box {
    border: 2px dashed #bdc3c7;
    border-radius: 12px;
    padding: 30px;
    text-align: center;
    transition: all 0.3s ease;
    cursor: pointer;
    background-color: #fafafa;
    min-height: 200px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .upload-box.has-file {
    border-color: #27ae60;
    background-color: #e8f5e9;
  }

  .upload-box:hover:not(.has-file) {
    border-color: #3498db;
    background-color: #ebf5fb;
  }

  .upload-icon {
    font-size: 2.5rem;
    margin-bottom: 10px;
  }

  .upload-label {
    font-weight: bold;
    color: #2c3e50;
    font-size: 1.1rem;
    margin-bottom: 10px;
  }

  .upload-text {
    color: #7f8c8d;
    font-size: 0.9rem;
    margin-bottom: 15px;
  }

  .file-name {
    color: #27ae60;
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 15px;
    word-break: break-all;
  }

  .file-input {
    display: none;
  }

  .upload-button {
    display: inline-block;
    background-color: #3498db;
    color: white;
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background-color 0.3s ease;
  }

  .upload-button:hover {
    background-color: #2980b9;
  }

  .vs-badge {
    background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%);
    color: white;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 1.1rem;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .submit-container {
    text-align: center;
    margin-top: 30px;
  }

  .submit-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 15px 40px;
    border: none;
    border-radius: 8px;
    font-size: 1.1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .submit-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.15);
  }

  .submit-btn:disabled {
    background: #bdc3c7;
    cursor: not-allowed;
    opacity: 0.7;
  }
</style>