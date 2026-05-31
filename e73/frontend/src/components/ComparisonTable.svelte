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

  const getChangeClass = (changeRate) => {
    if (changeRate > 0) return 'change-worse'
    if (changeRate < 0) return 'change-better'
    return 'change-neutral'
  }

  const getChangeArrow = (changeRate) => {
    if (changeRate > 0) return '↑'
    if (changeRate < 0) return '↓'
    return '—'
  }

  const getErrorRateClass = (rate) => {
    if (rate >= 5) return 'error-high'
    if (rate >= 1) return 'error-medium'
    return 'error-low'
  }
</script>

<div class="table-container">
  <h2>API 性能对比分析</h2>
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th rowspan="2">API 路径</th>
          <th colspan="2">请求数</th>
          <th colspan="3">P95 延迟</th>
          <th colspan="3">P99 延迟</th>
          <th colspan="3">错误率</th>
        </tr>
        <tr>
          <th>旧</th>
          <th>新</th>
          <th>旧</th>
          <th>新</th>
          <th>变化</th>
          <th>旧</th>
          <th>新</th>
          <th>变化</th>
          <th>旧</th>
          <th>新</th>
          <th>变化</th>
        </tr>
      </thead>
      <tbody>
        {#each data as row}
          <tr>
            <td class="path-cell">{row.api_path}</td>
            <td>{row.total_count_old || '-'}</td>
            <td>{row.total_count_new || '-'}</td>
            <td>{row.p95_latency_old ? formatLatency(row.p95_latency_old) : '-'}</td>
            <td>{row.p95_latency_new ? formatLatency(row.p95_latency_new) : '-'}</td>
            <td class={getChangeClass(row.p95_change_rate)}>
              {getChangeArrow(row.p95_change_rate)} {Math.abs(row.p95_change_rate).toFixed(1)}%
            </td>
            <td>{row.p99_latency_old ? formatLatency(row.p99_latency_old) : '-'}</td>
            <td>{row.p99_latency_new ? formatLatency(row.p99_latency_new) : '-'}</td>
            <td class={getChangeClass(row.p99_change_rate)}>
              {getChangeArrow(row.p99_change_rate)} {Math.abs(row.p99_change_rate).toFixed(1)}%
            </td>
            <td class={getErrorRateClass(row.error_rate_old)}>
              {formatPercent(row.error_rate_old)}
            </td>
            <td class={getErrorRateClass(row.error_rate_new)}>
              {formatPercent(row.error_rate_new)}
            </td>
            <td class={getChangeClass(row.error_rate_change)}>
              {getChangeArrow(row.error_rate_change)} {Math.abs(row.error_rate_change).toFixed(1)}%
            </td>
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
    font-size: 0.9rem;
  }

  th, td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid #ecf0f1;
    white-space: nowrap;
  }

  th {
    background-color: #3498db;
    color: white;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.5px;
  }

  thead tr:first-child th {
    background-color: #2980b9;
  }

  tr:hover {
    background-color: #f8f9fa;
  }

  .path-cell {
    font-family: 'Monaco', 'Consolas', monospace;
    color: #2c3e50;
    max-width: 250px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .change-better {
    color: #27ae60;
    font-weight: 600;
  }

  .change-worse {
    color: #e74c3c;
    font-weight: 600;
  }

  .change-neutral {
    color: #7f8c8d;
    font-weight: 600;
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