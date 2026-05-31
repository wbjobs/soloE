<script>
  import { createEventDispatcher } from 'svelte'

  const dispatch = createEventDispatcher()

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.csv')) {
      dispatch('upload', file)
    }
  }

  const handleChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      dispatch('upload', file)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
  }
</script>

<div 
  class="upload-container"
  on:drop={handleDrop}
  on:dragover={handleDragOver}
>
  <div class="upload-box">
    <div class="upload-icon">📁</div>
    <p class="upload-text">拖拽 CSV 文件到此处，或点击选择文件</p>
    <input 
      type="file" 
      accept=".csv" 
      class="file-input"
      on:change={handleChange}
    />
    <label class="upload-button" for="file-input">选择文件</label>
  </div>
</div>

<style>
  .upload-container {
    margin-bottom: 30px;
  }

  .upload-box {
    border: 2px dashed #bdc3c7;
    border-radius: 12px;
    padding: 40px;
    text-align: center;
    transition: all 0.3s ease;
    cursor: pointer;
    background-color: #fafafa;
  }

  .upload-box:hover,
  .upload-box.dragover {
    border-color: #3498db;
    background-color: #ebf5fb;
  }

  .upload-icon {
    font-size: 3rem;
    margin-bottom: 15px;
  }

  .upload-text {
    color: #7f8c8d;
    font-size: 1rem;
    margin-bottom: 20px;
  }

  .file-input {
    display: none;
  }

  .upload-button {
    display: inline-block;
    background-color: #3498db;
    color: white;
    padding: 12px 30px;
    border-radius: 6px;
    font-size: 1rem;
    cursor: pointer;
    transition: background-color 0.3s ease;
  }

  .upload-button:hover {
    background-color: #2980b9;
  }
</style>