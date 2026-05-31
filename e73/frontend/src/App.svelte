<script>
  import { onMount } from 'svelte'
  import DataTable from './components/DataTable.svelte'
  import ComparisonTable from './components/ComparisonTable.svelte'
  import Histogram from './components/Histogram.svelte'
  import FileUpload from './components/FileUpload.svelte'
  import ComparisonUpload from './components/ComparisonUpload.svelte'

  let mode = 'single' // 'single' or 'compare'
  let results = null
  let comparisonResults = null
  let loading = false
  let error = null

  const handleFileUpload = async (file) => {
    loading = true
    error = null
    comparisonResults = null

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error('Failed to analyze file')
      }

      results = await response.json()
    } catch (err) {
      error = err.message
    } finally {
      loading = false
    }
  }

  const handleComparisonUpload = async (fileOld, fileNew) => {
    loading = true
    error = null
    results = null

    const formData = new FormData()
    formData.append('file_old', fileOld)
    formData.append('file_new', fileNew)

    try {
      const response = await fetch('/api/compare', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error('Failed to compare files')
      }

      comparisonResults = await response.json()
    } catch (err) {
      error = err.message
    } finally {
      loading = false
    }
  }

  const switchMode = (newMode) => {
    mode = newMode
    results = null
    comparisonResults = null
    error = null
  }

  onMount(() => {
  })
</script>

<div class="app">
  <header>
    <h1>API 性能分析工具</h1>
    <p>上传 Wireshark 导出的 CSV 日志文件进行分析</p>
  </header>

  <main>
    <div class="mode-switcher">
      <button 
        class="mode-btn {mode === 'single' ? 'active' : ''}"
        on:click={() => switchMode('single')}
      >
        📊 单文件分析
      </button>
      <button 
        class="mode-btn {mode === 'compare' ? 'active' : ''}"
        on:click={() => switchMode('compare')}
      >
        🔄 对比模式
      </button>
    </div>

    {#if mode === 'single'}
      <FileUpload onUpload={handleFileUpload} />
    {:else}
      <ComparisonUpload onUpload={handleComparisonUpload} />
    {/if}

    {#if loading}
      <div class="loading">
        <div class="spinner"></div>
        <p>正在分析数据...</p>
      </div>
    {/if}

    {#if error}
      <div class="error">
        <p>❌ {error}</p>
      </div>
    {/if}

    {#if results}
      {#if results.skipped_count > 0}
        <div class="warning">
          <p>⚠️ 已跳过 {results.skipped_count} 条畸形数据</p>
        </div>
      {/if}

      <div class="summary">
        <div class="summary-card">
          <span class="summary-value">{results.total_requests}</span>
          <span class="summary-label">总请求数</span>
        </div>
        <div class="summary-card">
          <span class="summary-value">{results.total_errors}</span>
          <span class="summary-label">错误数</span>
        </div>
        <div class="summary-card">
          <span class="summary-value">{results.overall_error_rate.toFixed(2)}%</span>
          <span class="summary-label">错误率</span>
        </div>
      </div>

      <DataTable data={results.api_results} />
      <Histogram data={results.histogram} />
    {/if}

    {#if comparisonResults}
      {#if comparisonResults.skipped_count_old > 0 || comparisonResults.skipped_count_new > 0}
        <div class="warning">
          <p>⚠️ 旧文件已跳过 {comparisonResults.skipped_count_old} 条，新文件已跳过 {comparisonResults.skipped_count_new} 条畸形数据</p>
        </div>
      {/if}

      <div class="comparison-summary">
        <div class="summary-card comparison">
          <span class="summary-label">旧版</span>
          <span class="summary-value">{comparisonResults.total_requests_old}</span>
          <span class="summary-sub">总请求</span>
          <span class="summary-sub error">{comparisonResults.overall_error_rate_old.toFixed(2)}% 错误率</span>
        </div>
        <div class="summary-card comparison">
          <span class="summary-label">新版</span>
          <span class="summary-value">{comparisonResults.total_requests_new}</span>
          <span class="summary-sub">总请求</span>
          <span class="summary-sub error">{comparisonResults.overall_error_rate_new.toFixed(2)}% 错误率</span>
        </div>
        <div class="summary-card {comparisonResults.overall_p95_change_rate > 0 ? 'worse' : 'better'}">
          <span class="summary-label">P95 变化</span>
          <span class="summary-value">
            {comparisonResults.overall_p95_change_rate > 0 ? '↑' : '↓'}
            {Math.abs(comparisonResults.overall_p95_change_rate).toFixed(2)}%
          </span>
          <span class="summary-sub">
            {comparisonResults.overall_p95_change_rate > 0 ? '性能劣化' : '性能优化'}
          </span>
        </div>
      </div>

      <ComparisonTable data={comparisonResults.comparison_results} />
    {/if}
  </main>
</div>

<style>
  .app {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  }

  header {
    text-align: center;
    margin-bottom: 40px;
  }

  header h1 {
    color: #2c3e50;
    font-size: 2rem;
    margin-bottom: 10px;
  }

  header p {
    color: #7f8c8d;
    font-size: 1rem;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 40px;
  }

  .spinner {
    width: 50px;
    height: 50px;
    border: 4px solid #f3f3f3;
    border-top: 4px solid #3498db;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .error {
    background-color: #ffebee;
    border-left: 4px solid #e53935;
    padding: 15px 20px;
    margin: 20px 0;
    border-radius: 4px;
    color: #c62828;
  }

  .warning {
    background-color: #fff3e0;
    border-left: 4px solid #ff9800;
    padding: 15px 20px;
    margin: 20px 0;
    border-radius: 4px;
    color: #e65100;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 20px;
    margin: 30px 0;
  }

  .summary-card {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 20px;
    border-radius: 12px;
    text-align: center;
    color: white;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .summary-value {
    display: block;
    font-size: 2rem;
    font-weight: bold;
    margin-bottom: 5px;
  }

  .summary-label {
    font-size: 0.9rem;
    opacity: 0.9;
  }

  .mode-switcher {
    display: flex;
    gap: 10px;
    margin-bottom: 30px;
    justify-content: center;
  }

  .mode-btn {
    padding: 12px 24px;
    border: 2px solid #3498db;
    background-color: white;
    color: #3498db;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    transition: all 0.3s ease;
  }

  .mode-btn:hover {
    background-color: #ebf5fb;
  }

  .mode-btn.active {
    background-color: #3498db;
    color: white;
  }

  .comparison-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin: 30px 0;
  }

  .summary-card.comparison {
    background: linear-gradient(135deg, #5da0d8 0%, #2980b9 100%);
  }

  .summary-card.better {
    background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
  }

  .summary-card.worse {
    background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
  }

  .summary-sub {
    display: block;
    font-size: 0.8rem;
    opacity: 0.9;
    margin-top: 3px;
  }

  .summary-sub.error {
    color: #ffeb3b;
  }
</style>