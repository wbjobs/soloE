<script>
  export let data = []

  const maxCount = Math.max(...data.map(d => d.count), 1)

  const getBarWidth = (count) => {
    return (count / maxCount) * 100
  }

  const getBarColor = (range) => {
    if (range.includes('>=500')) return '#e74c3c'
    if (range.includes('500') || range.includes('200')) return '#f39c12'
    return '#27ae60'
  }
</script>

<div class="histogram-container">
  <h2>延迟分布直方图</h2>
  <div class="histogram">
    {#each data as bin}
      <div class="bar-wrapper">
        <div 
          class="bar" 
          style="width: {getBarWidth(bin.count)}%"
          style:background-color={getBarColor(bin.range)}
          title={`${bin.range}: ${bin.count} 次`}
        >
          <span class="bar-count">{bin.count}</span>
        </div>
        <span class="bar-label">{bin.range}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .histogram-container {
    margin: 30px 0;
    padding: 20px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  }

  .histogram-container h2 {
    color: #2c3e50;
    font-size: 1.5rem;
    margin-bottom: 20px;
  }

  .histogram {
    display: flex;
    align-items: flex-end;
    height: 200px;
    gap: 15px;
    padding: 20px 0;
    border-bottom: 2px solid #ecf0f1;
  }

  .bar-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .bar {
    width: 100%;
    max-width: 80px;
    min-height: 5px;
    border-radius: 4px 4px 0 0;
    position: relative;
    transition: height 0.3s ease;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 5px;
  }

  .bar:hover {
    opacity: 0.8;
  }

  .bar-count {
    color: white;
    font-size: 0.8rem;
    font-weight: bold;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  .bar-label {
    font-size: 0.75rem;
    color: #7f8c8d;
    text-align: center;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    white-space: nowrap;
  }
</style>