const fs = require('fs');

class FlameGraphGenerator {
  constructor() {
    this.colorPalette = {
      'user-srv': '#4CAF50',
      'order-srv': '#2196F3',
      'payment-srv': '#FF9800',
      'unknown': '#9E9E9E',
      'error': '#F44336'
    };
  }

  getServiceColor(service, hasError = false) {
    if (hasError) return this.colorPalette['error'];
    return this.colorPalette[service] || this.colorPalette['unknown'];
  }

  safeDuration(duration) {
    if (duration == null || isNaN(duration) || !isFinite(duration) || duration < 0) {
      return 1;
    }
    return Number(duration);
  }

  flattenSpans(spans, startTime, depth = 0) {
    const result = [];

    for (const span of spans) {
      const relativeStart = span.start - startTime;
      const duration = this.safeDuration(span.duration);

      result.push({
        spanId: span.spanId,
        service: span.service,
        operation: span.operation,
        start: Math.max(0, relativeStart),
        duration,
        depth,
        hasError: span.status === 'error' || span.level === 'error',
        logs: span.logs,
        children: span.children
      });

      if (span.children && span.children.length > 0) {
        const childResult = this.flattenSpans(span.children, startTime, depth + 1);
        result.push(...childResult);
      }
    }

    return result;
  }

  generateFlameGraphData(analyzedTrace) {
    const startTime = analyzedTrace.startTime;
    const totalDuration = this.safeDuration(analyzedTrace.totalDuration);
    const flattened = this.flattenSpans(analyzedTrace.spans, startTime);

    const maxDepth = flattened.length > 0 ? Math.max(...flattened.map(s => s.depth), 0) : 0;

    return {
      traceId: analyzedTrace.traceId,
      totalDuration,
      startTime,
      endTime: analyzedTrace.endTime,
      services: analyzedTrace.services,
      maxDepth,
      spans: flattened
    };
  }

  generateHTML(analyzedTrace, options = {}) {
    const graphData = this.generateFlameGraphData(analyzedTrace);
    const title = options.title || `Flame Graph - ${analyzedTrace.traceId}`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 1400px; margin: 0 auto; background: white; border-radius: 8px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { font-size: 20px; margin-bottom: 16px; color: #333; }
    .header { display: flex; gap: 24px; margin-bottom: 20px; padding: 16px; background: #f8f9fa; border-radius: 6px; flex-wrap: wrap; }
    .header-item { display: flex; flex-direction: column; }
    .header-label { font-size: 12px; color: #666; margin-bottom: 4px; }
    .header-value { font-size: 16px; font-weight: 600; color: #333; }
    .flame-container { position: relative; overflow-x: auto; background: #fff; border: 1px solid #e0e0e0; border-radius: 4px; }
    .flame-svg { display: block; }
    .flame-bar { cursor: pointer; transition: opacity 0.2s; }
    .flame-bar:hover { opacity: 0.8; }
    .tooltip { position: fixed; background: rgba(0,0,0,0.85); color: white; padding: 10px 12px; border-radius: 4px; font-size: 12px; pointer-events: none; z-index: 1000; max-width: 300px; }
    .tooltip .title { font-weight: 600; margin-bottom: 6px; }
    .tooltip .row { display: flex; justify-content: space-between; gap: 16px; margin: 2px 0; }
    .tooltip .label { color: #aaa; }
    .tooltip .value { color: #fff; }
    .legend { display: flex; gap: 16px; margin-top: 16px; padding: 12px; background: #f8f9fa; border-radius: 4px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .legend-color { width: 16px; height: 16px; border-radius: 2px; }
    .timeline { position: relative; height: 24px; background: #f0f0f0; border-radius: 4px; margin-bottom: 8px; overflow: hidden; }
    .timeline-mark { position: absolute; top: 0; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #666; border-left: 1px solid #ccc; }
    .error-badge { background: #F44336; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
    .no-data { text-align: center; padding: 60px 20px; color: #999; }
    .no-data-icon { font-size: 48px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div id="app"></div>
  </div>

  <script>
    const colorPalette = ${JSON.stringify(this.colorPalette)};
    const graphData = ${JSON.stringify(graphData)};
    
    function getServiceColor(service, hasError) {
      if (hasError) return colorPalette['error'];
      return colorPalette[service] || colorPalette['unknown'];
    }

    function formatDuration(ms) {
      if (ms == null || isNaN(ms)) return '0ms';
      if (ms < 1) return (ms * 1000).toFixed(0) + 'μs';
      if (ms < 1000) return ms.toFixed(2) + 'ms';
      return (ms / 1000).toFixed(2) + 's';
    }

    function formatTime(ts) {
      return new Date(ts).toLocaleString();
    }

    function renderFlameGraph(data, containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (!data || !data.spans || data.spans.length === 0) {
        container.innerHTML = '<div class="no-data"><div class="no-data-icon">📊</div><p>没有找到调用链数据</p></div>';
        return;
      }

      const barHeight = 24;
      const padding = 10;
      const minWidth = 1200;
      const totalDuration = Math.max(1, data.totalDuration);
      const width = Math.max(minWidth, totalDuration / 2);
      const height = (data.maxDepth + 1) * barHeight + padding * 2 + 40;
      const pixelsPerMs = (width - padding * 2) / totalDuration;

      let html = '';
      html += '<div class="timeline" style="width: ' + width + 'px">';
      const ticks = 5;
      for (let i = 0; i <= ticks; i++) {
        const pos = (i / ticks) * 100;
        const time = (i / ticks) * totalDuration;
        html += '<div class="timeline-mark" style="left: ' + pos + '%">' + formatDuration(time) + '</div>';
      }
      html += '</div>';
      
      html += '<svg class="flame-svg" width="' + width + '" height="' + height + '">';

      for (const span of data.spans) {
        const duration = Math.max(1, span.duration);
        const x = padding + span.start * pixelsPerMs;
        const y = height - padding - (span.depth + 1) * barHeight;
        const rectWidth = Math.max(duration * pixelsPerMs, 2);
        const color = getServiceColor(span.service, span.hasError);
        const label = span.service + ' > ' + span.operation;
        const displayLabel = rectWidth > 80 ? label.substring(0, Math.floor(rectWidth / 7)) + (rectWidth / 7 < label.length ? '...' : '') : '';

        html += '<g class="flame-bar" data-span=\'' + encodeURIComponent(JSON.stringify(span)) + '\'>';
        html += '<rect x="' + x + '" y="' + y + '" width="' + rectWidth + '" height="' + (barHeight - 2) + '" fill="' + color + '" rx="2"/>';
        if (displayLabel) {
          html += '<text x="' + (x + 6) + '" y="' + (y + barHeight / 2 + 4) + '" fill="white" font-size="11" font-family="monospace">' + displayLabel + '</text>';
        }
        html += '</g>';
      }

      html += '</svg>';
      container.innerHTML = html;

      const bars = container.querySelectorAll('.flame-bar');
      let tooltip = document.querySelector('.tooltip');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.style.display = 'none';
        document.body.appendChild(tooltip);
      }

      bars.forEach(bar => {
        bar.addEventListener('mousemove', (e) => {
          const spanData = JSON.parse(decodeURIComponent(bar.dataset.span));
          tooltip.style.display = 'block';
          tooltip.style.left = (e.clientX + 15) + 'px';
          tooltip.style.top = (e.clientY + 15) + 'px';
          
          let logPreview = '';
          if (spanData.logs && spanData.logs.length > 0) {
            logPreview = '<div class="row"><span class="label">日志数:</span><span class="value">' + spanData.logs.length + '</span></div>';
            const lastLog = spanData.logs[spanData.logs.length - 1];
            if (lastLog.message) {
              logPreview += '<div style="margin-top:4px; padding-top:4px; border-top:1px solid #444"><strong>最新日志:</strong><br>' + lastLog.message.substring(0, 100) + '</div>';
            }
          }

          tooltip.innerHTML = '<div class="title">' + spanData.service + ' > ' + spanData.operation + '</div>' +
            '<div class="row"><span class="label">耗时:</span><span class="value">' + formatDuration(spanData.duration) + '</span></div>' +
            '<div class="row"><span class="label">开始偏移:</span><span class="value">' + formatDuration(spanData.start) + '</span></div>' +
            '<div class="row"><span class="label">层级:</span><span class="value">' + spanData.depth + '</span></div>' +
            (spanData.hasError ? '<div class="row"><span class="error-badge">ERROR</span></div>' : '') +
            logPreview;
        });

        bar.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });
    }

    function renderHeader(data) {
      const container = document.getElementById('trace-header');
      if (!container) return;
      
      container.innerHTML = '<div class="header-item"><span class="header-label">Trace ID</span><span class="header-value" style="font-family: monospace; font-size: 13px;">' + data.traceId + '</span></div>' +
        '<div class="header-item"><span class="header-label">总耗时</span><span class="header-value">' + formatDuration(data.totalDuration) + '</span></div>' +
        '<div class="header-item"><span class="header-label">开始时间</span><span class="header-value">' + formatTime(data.startTime) + '</span></div>' +
        '<div class="header-item"><span class="header-label">服务数</span><span class="header-value">' + (data.services ? data.services.length : 0) + '</span></div>' +
        '<div class="header-item"><span class="header-label">跨度数</span><span class="header-value">' + (data.spans ? data.spans.length : 0) + '</span></div>';
    }

    function init() {
      const app = document.getElementById('app');
      
      if (!graphData || !graphData.spans || graphData.spans.length === 0) {
        app.innerHTML = '<div class="no-data"><div class="no-data-icon">📊</div><p>没有找到调用链数据，请检查日志文件是否包含有效的 traceId</p></div>';
        return;
      }

      app.innerHTML = '<h1>🔥 火焰图 - ' + graphData.traceId + '</h1>' +
        '<div class="header" id="trace-header"></div>' +
        '<div class="flame-container"><div id="flame-graph"></div></div>' +
        '<div class="legend">' +
          '<div class="legend-item"><div class="legend-color" style="background: #4CAF50"></div>user-srv</div>' +
          '<div class="legend-item"><div class="legend-color" style="background: #2196F3"></div>order-srv</div>' +
          '<div class="legend-item"><div class="legend-color" style="background: #FF9800"></div>payment-srv</div>' +
          '<div class="legend-item"><div class="legend-color" style="background: #F44336"></div>错误</div>' +
          '<div class="legend-item"><div class="legend-color" style="background: #9E9E9E"></div>未知服务</div>' +
        '</div>';

      renderHeader(graphData);
      renderFlameGraph(graphData, 'flame-graph');
    }

    init();
  </script>
</body>
</html>`;
  }

  generateMultiTraceHTML(analyzedTraces, options = {}) {
    const tracesData = analyzedTraces || [];
    
    if (tracesData.length === 0) {
      return this.generateEmptyHTML('没有找到调用链数据');
    }

    const firstGraphData = this.generateFlameGraphData(tracesData[0]);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>日志分析 - 火焰图</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; color: #333; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
    header { text-align: center; padding: 24px 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 12px; margin-bottom: 24px; }
    header h1 { font-size: 24px; margin-bottom: 8px; }
    header p { opacity: 0.9; font-size: 14px; }
    
    .card { background: white; border-radius: 8px; padding: 24px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card h2 { font-size: 18px; margin-bottom: 16px; color: #333; }
    
    .tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; }
    .tab { padding: 12px 20px; border: none; background: none; cursor: pointer; font-size: 14px; color: #718096; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .tab.active { color: #667eea; border-bottom-color: #667eea; }
    
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: #f7fafc; padding: 16px; border-radius: 8px; }
    .stat-label { font-size: 12px; color: #718096; margin-bottom: 4px; }
    .stat-value { font-size: 24px; font-weight: 600; color: #2d3748; }
    
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f7fafc; font-weight: 600; color: #4a5568; }
    tr:hover { background: #f7fafc; }
    
    .trace-row { cursor: pointer; }
    .trace-row.selected { background: #e6fffa; }
    
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; }
    .badge-success { background: #c6f6d5; color: #22543d; }
    .badge-error { background: #fed7d7; color: #742a2a; }
    .badge-info { background: #bee3f8; color: #2a4365; }
    
    .comparison-select { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .comparison-select select { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 13px; min-width: 200px; }
    
    .diff-positive { color: #e53e3e; }
    .diff-negative { color: #38a169; }
    
    .flamegraph-container { margin-top: 16px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .flamegraph-container .header { margin: 0; padding: 12px; border-radius: 0; background: #f7fafc; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; }
    .flamegraph-svg-container { overflow-x: auto; }
    
    .btn { padding: 8px 16px; border: none; border-radius: 4px; font-size: 13px; cursor: pointer; transition: all 0.2s; }
    .btn-secondary { background: #edf2f7; color: #4a5568; }
    .btn-secondary:hover { background: #e2e8f0; }
    
    .service-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-right: 4px; }
    .service-user { background: #c6f6d5; color: #22543d; }
    .service-order { background: #bee3f8; color: #2a4365; }
    .service-payment { background: #feebc8; color: #744210; }
    .service-unknown { background: #e2e8f0; color: #4a5568; }
    
    .timeline { position: relative; height: 24px; background: #f0f0f0; border-radius: 4px; margin-bottom: 8px; overflow: hidden; }
    .timeline-mark { position: absolute; top: 0; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #666; border-left: 1px solid #ccc; }
    .flame-svg { display: block; }
    .flame-bar { cursor: pointer; transition: opacity 0.2s; }
    .flame-bar:hover { opacity: 0.8; }
    .tooltip { position: fixed; background: rgba(0,0,0,0.85); color: white; padding: 10px 12px; border-radius: 4px; font-size: 12px; pointer-events: none; z-index: 1000; max-width: 300px; }
    .tooltip .title { font-weight: 600; margin-bottom: 6px; }
    .tooltip .row { display: flex; justify-content: space-between; gap: 16px; margin: 2px 0; }
    .tooltip .label { color: #aaa; }
    .tooltip .value { color: #fff; }
    .error-badge { background: #F44336; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; }
    .legend { display: flex; gap: 16px; margin-top: 16px; padding: 12px; background: #f8f9fa; border-radius: 4px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .legend-color { width: 16px; height: 16px; border-radius: 2px; }
    
    .main-content { display: grid; grid-template-columns: 320px 1fr; gap: 20px; }
    @media (max-width: 900px) { .main-content { grid-template-columns: 1fr; } }
    
    .trace-list-container { max-height: 600px; overflow-y: auto; }
    .trace-item { padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s; }
    .trace-item:hover { border-color: #667eea; background: #f0f4ff; }
    .trace-item.active { border-color: #667eea; background: #e3f2fd; }
    .trace-info { display: flex; justify-content: space-between; align-items: center; }
    .trace-id { font-family: monospace; font-size: 12px; }
    .trace-duration { font-weight: 600; color: #667eea; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 日志分析工具</h1>
      <p>分布式系统调用链可视化与性能对比</p>
    </header>

    <div class="tabs">
      <button class="tab active" data-tab="overview">📊 概览</button>
      <button class="tab" data-tab="traces">🔗 调用链</button>
      <button class="tab" data-tab="compare">⚖️ 对比</button>
    </div>

    <div id="tab-overview" class="tab-content active">
      <div class="card">
        <h2>统计概览</h2>
        <div id="statsGrid" class="stats-grid"></div>
        
        <h3 style="margin-top: 24px; margin-bottom: 12px;">服务统计</h3>
        <table id="serviceStatsTable">
          <thead>
            <tr>
              <th>服务</th>
              <th>调用次数</th>
              <th>总耗时 (ms)</th>
              <th>平均耗时 (ms)</th>
              <th>最小 (ms)</th>
              <th>最大 (ms)</th>
              <th>错误数</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <div id="tab-traces" class="tab-content">
      <div class="card">
        <div class="main-content">
          <div>
            <h2>调用链列表</h2>
            <div id="traceList" class="trace-list-container"></div>
          </div>
          <div>
            <div id="flamegraphContainer" style="display: none;">
              <div class="header">
                <strong id="flamegraphTitle">🔥 火焰图</strong>
                <button class="btn btn-secondary" id="closeFlamegraph">关闭</button>
              </div>
              <div class="flamegraph-svg-container">
                <div id="flame-graph"></div>
              </div>
              <div class="legend">
                <div class="legend-item"><div class="legend-color" style="background: #4CAF50"></div>user-srv</div>
                <div class="legend-item"><div class="legend-color" style="background: #2196F3"></div>order-srv</div>
                <div class="legend-item"><div class="legend-color" style="background: #FF9800"></div>payment-srv</div>
                <div class="legend-item"><div class="legend-color" style="background: #F44336"></div>错误</div>
                <div class="legend-item"><div class="legend-color" style="background: #9E9E9E"></div>未知服务</div>
              </div>
            </div>
            <div id="traceDetailPlaceholder" style="text-align: center; padding: 60px 20px; color: #999;">
              <div style="font-size: 48px; margin-bottom: 16px;">👈</div>
              <p>请从左侧选择一条调用链查看火焰图</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div id="tab-compare" class="tab-content">
      <div class="card">
        <h2>调用链对比</h2>
        <div class="comparison-select">
          <span>调用链 1:</span>
          <select id="compareSelect1"></select>
          <span>调用链 2:</span>
          <select id="compareSelect2"></select>
          <button class="btn btn-secondary" id="compareBtn">开始对比</button>
        </div>
        
        <div id="comparisonResult"></div>
      </div>
    </div>
  </div>

  <script>
    const tracesData = ${JSON.stringify(tracesData)};
    
    const colorPalette = ${JSON.stringify(this.colorPalette)};
    
    function getServiceColor(service, hasError) {
      if (hasError) return colorPalette['error'];
      return colorPalette[service] || colorPalette['unknown'];
    }

    function formatDuration(ms) {
      if (ms == null || isNaN(ms)) return '0ms';
      if (ms < 1) return (ms * 1000).toFixed(0) + 'μs';
      if (ms < 1000) return ms.toFixed(2) + 'ms';
      return (ms / 1000).toFixed(2) + 's';
    }

    function formatTime(ts) {
      return new Date(ts).toLocaleString();
    }

    function safeDuration(duration) {
      if (duration == null || isNaN(duration) || !isFinite(duration) || duration < 0) {
        return 1;
      }
      return Number(duration);
    }

    function flattenSpans(spans, startTime, depth = 0) {
      const result = [];
      for (const span of spans) {
        const relativeStart = span.start - startTime;
        const duration = safeDuration(span.duration);
        result.push({
          spanId: span.spanId,
          service: span.service,
          operation: span.operation,
          start: Math.max(0, relativeStart),
          duration,
          depth,
          hasError: span.status === 'error' || span.level === 'error',
          logs: span.logs,
          children: span.children
        });
        if (span.children && span.children.length > 0) {
          result.push(...flattenSpans(span.children, startTime, depth + 1));
        }
      }
      return result;
    }

    function generateFlameGraphData(analyzedTrace) {
      const startTime = analyzedTrace.startTime;
      const totalDuration = safeDuration(analyzedTrace.totalDuration);
      const flattened = flattenSpans(analyzedTrace.spans, startTime);
      const maxDepth = flattened.length > 0 ? Math.max(...flattened.map(s => s.depth), 0) : 0;
      return {
        traceId: analyzedTrace.traceId,
        totalDuration,
        startTime,
        endTime: analyzedTrace.endTime,
        services: analyzedTrace.services,
        maxDepth,
        spans: flattened
      };
    }

    function renderFlameGraph(data, containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (!data || !data.spans || data.spans.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">没有数据</div>';
        return;
      }

      const barHeight = 24;
      const padding = 10;
      const minWidth = 1000;
      const totalDuration = Math.max(1, data.totalDuration);
      const width = Math.max(minWidth, totalDuration / 2);
      const height = (data.maxDepth + 1) * barHeight + padding * 2 + 40;
      const pixelsPerMs = (width - padding * 2) / totalDuration;

      let html = '';
      html += '<div class="timeline" style="width: ' + width + 'px">';
      const ticks = 5;
      for (let i = 0; i <= ticks; i++) {
        const pos = (i / ticks) * 100;
        const time = (i / ticks) * totalDuration;
        html += '<div class="timeline-mark" style="left: ' + pos + '%">' + formatDuration(time) + '</div>';
      }
      html += '</div>';
      
      html += '<svg class="flame-svg" width="' + width + '" height="' + height + '">';

      for (const span of data.spans) {
        const duration = Math.max(1, span.duration);
        const x = padding + span.start * pixelsPerMs;
        const y = height - padding - (span.depth + 1) * barHeight;
        const rectWidth = Math.max(duration * pixelsPerMs, 2);
        const color = getServiceColor(span.service, span.hasError);
        const label = span.service + ' > ' + span.operation;
        const displayLabel = rectWidth > 80 ? label.substring(0, Math.floor(rectWidth / 7)) + (rectWidth / 7 < label.length ? '...' : '') : '';

        html += '<g class="flame-bar" data-span=\'' + encodeURIComponent(JSON.stringify(span)) + '\'>';
        html += '<rect x="' + x + '" y="' + y + '" width="' + rectWidth + '" height="' + (barHeight - 2) + '" fill="' + color + '" rx="2"/>';
        if (displayLabel) {
          html += '<text x="' + (x + 6) + '" y="' + (y + barHeight / 2 + 4) + '" fill="white" font-size="11" font-family="monospace">' + displayLabel + '</text>';
        }
        html += '</g>';
      }

      html += '</svg>';
      container.innerHTML = html;

      const bars = container.querySelectorAll('.flame-bar');
      let tooltip = document.querySelector('.tooltip');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'tooltip';
        tooltip.style.display = 'none';
        document.body.appendChild(tooltip);
      }

      bars.forEach(bar => {
        bar.addEventListener('mousemove', (e) => {
          const spanData = JSON.parse(decodeURIComponent(bar.dataset.span));
          tooltip.style.display = 'block';
          tooltip.style.left = (e.clientX + 15) + 'px';
          tooltip.style.top = (e.clientY + 15) + 'px';
          
          let logPreview = '';
          if (spanData.logs && spanData.logs.length > 0) {
            logPreview = '<div class="row"><span class="label">日志数:</span><span class="value">' + spanData.logs.length + '</span></div>';
            const lastLog = spanData.logs[spanData.logs.length - 1];
            if (lastLog.message) {
              logPreview += '<div style="margin-top:4px; padding-top:4px; border-top:1px solid #444"><strong>最新日志:</strong><br>' + lastLog.message.substring(0, 100) + '</div>';
            }
          }

          tooltip.innerHTML = '<div class="title">' + spanData.service + ' > ' + spanData.operation + '</div>' +
            '<div class="row"><span class="label">耗时:</span><span class="value">' + formatDuration(spanData.duration) + '</span></div>' +
            '<div class="row"><span class="label">开始偏移:</span><span class="value">' + formatDuration(spanData.start) + '</span></div>' +
            '<div class="row"><span class="label">层级:</span><span class="value">' + spanData.depth + '</span></div>' +
            (spanData.hasError ? '<div class="row"><span class="error-badge">ERROR</span></div>' : '') +
            logPreview;
        });

        bar.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });
    }

    function renderOverview(traces) {
      const totalDuration = traces.reduce((sum, t) => sum + safeDuration(t.totalDuration), 0);
      const avgDuration = traces.length > 0 ? totalDuration / traces.length : 0;
      const totalErrors = traces.reduce((sum, t) => sum + (t.errorCount || 0), 0);
      const totalSpans = traces.reduce((sum, t) => sum + (t.spanCount || 0), 0);
      
      document.getElementById('statsGrid').innerHTML = \`
        <div class="stat-card">
          <div class="stat-label">调用链数量</div>
          <div class="stat-value">\${traces.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">总跨度数</div>
          <div class="stat-value">\${totalSpans}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">平均耗时</div>
          <div class="stat-value">\${formatDuration(avgDuration)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">错误总数</div>
          <div class="stat-value" style="color: \${totalErrors > 0 ? '#e53e3e' : '#38a169'}">\${totalErrors}</div>
        </div>
      \`;
      
      const serviceStats = new Map();
      for (const trace of traces) {
        const processSpans = (spans) => {
          for (const span of spans) {
            if (!serviceStats.has(span.service)) {
              serviceStats.set(span.service, {
                service: span.service,
                totalCalls: 0,
                totalDuration: 0,
                errors: 0,
                minDuration: Infinity,
                maxDuration: 0
              });
            }
            const stats = serviceStats.get(span.service);
            stats.totalCalls++;
            const duration = safeDuration(span.duration);
            stats.totalDuration += duration;
            if (duration < stats.minDuration) stats.minDuration = duration;
            if (duration > stats.maxDuration) stats.maxDuration = duration;
            if (span.status === 'error') stats.errors++;
            if (span.children && span.children.length > 0) {
              processSpans(span.children);
            }
          }
        };
        processSpans(trace.spans);
      }

      const tbody = document.querySelector('#serviceStatsTable tbody');
      tbody.innerHTML = '';
      for (const stats of serviceStats.values()) {
        const avg = stats.totalCalls > 0 ? stats.totalDuration / stats.totalCalls : 0;
        const row = document.createElement('tr');
        row.innerHTML = \`
          <td><strong>\${stats.service}</strong></td>
          <td>\${stats.totalCalls}</td>
          <td>\${stats.totalDuration.toFixed(0)}</td>
          <td>\${avg.toFixed(0)}</td>
          <td>\${stats.minDuration === Infinity ? 0 : stats.minDuration.toFixed(0)}</td>
          <td>\${stats.maxDuration.toFixed(0)}</td>
          <td style="color: \${stats.errors > 0 ? '#e53e3e' : '#38a169'}">\${stats.errors}</td>
        \`;
        tbody.appendChild(row);
      }
    }

    function renderTraceList(traces, onSelect) {
      const container = document.getElementById('traceList');
      if (!container) return;

      let html = '';
      const sorted = [...traces].sort((a, b) => safeDuration(b.totalDuration) - safeDuration(a.totalDuration));
      
      for (let i = 0; i < sorted.length; i++) {
        const trace = sorted[i];
        const hasError = (trace.errorCount || 0) > 0;
        const isActive = i === 0 ? 'active' : '';
        
        const servicesHtml = trace.services.map(s => {
          const cls = s === 'user-srv' ? 'service-user' : s === 'order-srv' ? 'service-order' : s === 'payment-srv' ? 'service-payment' : 'service-unknown';
          return \`<span class="service-tag \${cls}">\${s}</span>\`;
        }).join('');
        
        html += \`
          <div class="trace-item \${isActive}" data-trace-id="\${trace.traceId}">
            <div class="trace-info">
              <span class="trace-id">\${trace.traceId.substring(0, 18)}...</span>
              <span class="trace-duration">\${formatDuration(trace.totalDuration)}</span>
            </div>
            <div style="font-size: 11px; color: #666; margin-top: 4px;">
              \${servicesHtml}
              \${hasError ? \`<span class="badge badge-error" style="margin-left: 4px;">\${trace.errorCount} 错误</span>\` : ''}
            </div>
          </div>
        \`;
      }
      
      container.innerHTML = html;

      container.querySelectorAll('.trace-item').forEach(item => {
        item.addEventListener('click', () => {
          container.querySelectorAll('.trace-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          onSelect(item.dataset.traceId);
        });
      });
    }

    function showTrace(traceId) {
      const trace = tracesData.find(t => t.traceId === traceId);
      if (!trace) return;
      
      const graphData = generateFlameGraphData(trace);
      
      document.getElementById('traceDetailPlaceholder').style.display = 'none';
      document.getElementById('flamegraphContainer').style.display = 'block';
      document.getElementById('flamegraphTitle').textContent = \`🔥 火焰图 - \${traceId}\`;
      
      renderFlameGraph(graphData, 'flame-graph');
    }

    function renderCompareSelects(traces) {
      const sorted = [...traces].sort((a, b) => safeDuration(b.totalDuration) - safeDuration(a.totalDuration));
      const select1 = document.getElementById('compareSelect1');
      const select2 = document.getElementById('compareSelect2');
      
      select1.innerHTML = '';
      select2.innerHTML = '';
      
      sorted.forEach((trace, i) => {
        const opt1 = document.createElement('option');
        opt1.value = trace.traceId;
        opt1.textContent = \`\${trace.traceId} (\${formatDuration(trace.totalDuration)})\`;
        select1.appendChild(opt1);
        
        const opt2 = document.createElement('option');
        opt2.value = trace.traceId;
        opt2.textContent = \`\${trace.traceId} (\${formatDuration(trace.totalDuration)})\`;
        if (i === 1) opt2.selected = true;
        select2.appendChild(opt2);
      });
    }

    function compareTraces(trace1, trace2) {
      const getFlattenSpans = (spans, prefix = '') => {
        const result = [];
        for (const span of spans) {
          const key = prefix + span.service + ':' + span.operation;
          result.push({
            key,
            service: span.service,
            operation: span.operation,
            duration: safeDuration(span.duration)
          });
          if (span.children && span.children.length > 0) {
            result.push(...getFlattenSpans(span.children, key + ' > '));
          }
        }
        return result;
      };

      const spans1 = getFlattenSpans(trace1.spans);
      const spans2 = getFlattenSpans(trace2.spans);

      const map1 = new Map(spans1.map(s => [s.key, s]));
      const map2 = new Map(spans2.map(s => [s.key, s]));

      const allKeys = new Set([...map1.keys(), ...map2.keys()]);
      const comparison = [];

      for (const key of allKeys) {
        const s1 = map1.get(key);
        const s2 = map2.get(key);
        
        const d1 = s1 ? s1.duration : 0;
        const d2 = s2 ? s2.duration : 0;
        const diff = d2 - d1;
        const diffPercent = d1 > 0 ? ((diff / d1) * 100) : (d2 > 0 ? 100 : 0);

        comparison.push({
          key,
          service: s1?.service || s2?.service,
          operation: s1?.operation || s2?.operation,
          duration1: d1,
          duration2: d2,
          diff,
          diffPercent: Number(diffPercent.toFixed(2)),
          inTrace1: !!s1,
          inTrace2: !!s2
        });
      }

      return {
        trace1: {
          traceId: trace1.traceId,
          totalDuration: safeDuration(trace1.totalDuration),
          spanCount: trace1.spanCount
        },
        trace2: {
          traceId: trace2.traceId,
          totalDuration: safeDuration(trace2.totalDuration),
          spanCount: trace2.spanCount
        },
        totalDiff: safeDuration(trace2.totalDuration) - safeDuration(trace1.totalDuration),
        totalDiffPercent: trace1.totalDuration > 0 
          ? (((safeDuration(trace2.totalDuration) - safeDuration(trace1.totalDuration)) / safeDuration(trace1.totalDuration)) * 100).toFixed(2)
          : '0',
        details: comparison.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      };
    }

    function renderComparison(comparison) {
      const container = document.getElementById('comparisonResult');
      
      const totalDiffClass = comparison.totalDiff > 0 ? 'diff-positive' : 'diff-negative';
      
      let html = \`
        <div style="padding: 16px; background: #f7fafc; border-radius: 8px; margin-bottom: 16px;">
          <div style="display: flex; gap: 24px; flex-wrap: wrap; align-items: center;">
            <div><strong>Trace 1:</strong> \${comparison.trace1.traceId} (\${formatDuration(comparison.trace1.totalDuration)})</div>
            <div style="font-size: 20px;">→</div>
            <div><strong>Trace 2:</strong> \${comparison.trace2.traceId} (\${formatDuration(comparison.trace2.totalDuration)})</div>
            <div style="margin-left: auto;"><strong>总差异:</strong> <span class="\${totalDiffClass}">\${comparison.totalDiff > 0 ? '+' : ''}\${formatDuration(comparison.totalDiff)} (\${comparison.totalDiff > 0 ? '+' : ''}\${comparison.totalDiffPercent}%)</span></div>
          </div>
        </div>
        
        <table>
          <thead>
            <tr>
              <th>路径</th>
              <th>Trace 1 (ms)</th>
              <th>Trace 2 (ms)</th>
              <th>差异 (ms)</th>
              <th>差异 (%)</th>
            </tr>
          </thead>
          <tbody>
      \`;
      
      comparison.details.forEach(d => {
        const diffClass = d.diff > 0 ? 'diff-positive' : 'diff-negative';
        html += \`
          <tr>
            <td style="font-family: monospace; font-size: 12px;">\${d.key}</td>
            <td>\${d.inTrace1 ? d.duration1.toFixed(2) : '-'}</td>
            <td>\${d.inTrace2 ? d.duration2.toFixed(2) : '-'}</td>
            <td class="\${diffClass}">\${d.diff > 0 ? '+' : ''}\${d.diff.toFixed(2)}</td>
            <td class="\${diffClass}">\${d.diffPercent > 0 ? '+' : ''}\${d.diffPercent}%</td>
          </tr>
        \`;
      });
      
      html += '</tbody></table>';
      container.innerHTML = html;
    }

    function init() {
      if (tracesData.length === 0) {
        document.querySelector('.container').innerHTML = '<div class="card" style="text-align: center; padding: 60px;"><div style="font-size: 48px; margin-bottom: 16px;">📭</div><p>没有找到调用链数据</p></div>';
        return;
      }

      renderOverview(tracesData);
      renderTraceList(tracesData, showTrace);
      renderCompareSelects(tracesData);

      const sorted = [...tracesData].sort((a, b) => safeDuration(b.totalDuration) - safeDuration(a.totalDuration));
      if (sorted.length > 0) {
        showTrace(sorted[0].traceId);
      }

      document.getElementById('closeFlamegraph').addEventListener('click', () => {
        document.getElementById('flamegraphContainer').style.display = 'none';
        document.getElementById('traceDetailPlaceholder').style.display = 'block';
        document.querySelectorAll('.trace-item').forEach(i => i.classList.remove('active'));
      });

      document.getElementById('compareBtn').addEventListener('click', () => {
        const trace1 = tracesData.find(t => t.traceId === document.getElementById('compareSelect1').value);
        const trace2 = tracesData.find(t => t.traceId === document.getElementById('compareSelect2').value);
        if (trace1 && trace2 && trace1.traceId !== trace2.traceId) {
          const comparison = compareTraces(trace1, trace2);
          renderComparison(comparison);
        } else if (trace1 && trace2 && trace1.traceId === trace2.traceId) {
          alert('请选择不同的调用链进行对比');
        }
      });

      document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          tab.classList.add('active');
          document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
      });
    }

    init();
  </script>
</body>
</html>`;
  }

  generateEmptyHTML(message) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>日志分析</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 40px; text-align: center; }
    .container { max-width: 600px; margin: 0 auto; background: white; padding: 60px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 20px; color: #333; margin-bottom: 8px; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📭</div>
    <h1>没有数据</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
  }

  saveToFile(html, filePath) {
    try {
      fs.writeFileSync(filePath, html, 'utf-8');
      return true;
    } catch (error) {
      console.error('保存文件失败:', error);
      return false;
    }
  }
}

module.exports = FlameGraphGenerator;
