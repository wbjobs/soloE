<script>
  export let data = []

  const formatNumber = (num) => {
    return num.toLocaleString()
  }

  const formatPercent = (num) => {
    return num.toFixed(2) + '%'
  }

  const formatLatency = (num) => {
    return num.toFixed(2) + 'ms'
  }

  const getErrorRateClass = (rate) => {
    if (rate >= 5) return 'error-high'
    if (rate >= 1) return 'error-medium'
    return 'error-low'
  }
</script>

<div class="table-container">
  <h2>API 路径分析结果</h2>
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>API 路径</th>
          <th>请求数</th>
          <th>错误数</th>
          <th>错误率</th>
          <th>P95 延迟</th>
          <th>P99 延迟</th>
          <th>最小延迟</th>
          <th>最大延迟</th>
          <th>平均延迟</th>
        </tr>
      </thead>
      <tbody>
        {#each data as row}
          <tr>
            <td class="path-cell">{row.api_path}</td>
            <td>{formatNumber(row.total_count)}</td>
            <td>{formatNumber(row.error_count)}</td>
            <td class={getErrorRateClass(row.error_rate)}>{formatPercent(row.error_rate)}</td>
            <td>{formatLatency(row.p95_latency)}</td>
            <td>{formatLatency(row.p99_latency)}</td>
            <td>{formatLatency(row.min_latency)}</td>
            <td>{formatLatency(row.max_latency)}</td>
            <td>{formatLatency(row.avg_latency)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .table-container {
    margin: 30px 0;
  }

  .table-container h2 {
    color: #2c3e50;
    font-size: 1.5rem;
    margin-bottom: 20px;
  }

  .table-wrapper {
    overflow-x: auto;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background: white;
  }

  th, td {
    padding: 12px 15px;
    text-align: left;
    border-bottom: 1px solid #ecf0f1;
  }

  th {
    background-color: #3498db;
    color: white;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.85rem;
    letter-spacing: 0.5px;
  }

  tr:hover {
    background-color: #f8f9fa;
  }

  .path-cell {
    font-family: 'Monaco', 'Consolas', monospace;
    color: #2c3e50;
  }

  .error-low {
    color: #27ae60;
    font-weight: 600;
  }

  .error-medium {
    color: #f39c12;
    font-weight: 600;
  }

  .error-high {
    color: #e74c3c;
    font-weight: 600;
  }
</style>