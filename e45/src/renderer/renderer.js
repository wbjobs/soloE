const { ipcRenderer } = require('electron');

let currentRepoPath = null;
let analysisData = null;

function sanitizeDisplayString(str) {
  if (typeof str !== 'string') {
    return '';
  }
  try {
    let result = str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/\uFFFD/g, '');
    return result.normalize('NFC');
  } catch {
    return String(str || '');
  }
}

async function selectRepo() {
  const repoPath = await ipcRenderer.invoke('select-folder');
  if (repoPath) {
    currentRepoPath = repoPath;
    await analyzeRepo(repoPath);
  }
}

async function refreshRepo() {
  if (currentRepoPath) {
    await ipcRenderer.invoke('refresh-repo', currentRepoPath);
    await analyzeRepo(currentRepoPath);
  }
}

async function analyzeRepo(repoPath) {
  try {
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    
    showLoading();
    
    analysisData = await ipcRenderer.invoke('analyze-repo', repoPath);
    
    renderDashboard(analysisData);
    
    document.getElementById('refreshBtn').disabled = false;
  } catch (error) {
    alert('分析失败: ' + error.message);
    document.getElementById('welcome').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
  }
}

function showLoading() {
  document.getElementById('totalCommits').textContent = '...';
  document.getElementById('totalContributors').textContent = '...';
  document.getElementById('totalAnomalies').textContent = '...';
  document.getElementById('repoPath').textContent = '分析中...';
}

function renderDashboard(data) {
  document.getElementById('totalCommits').textContent = data.totalCommits;
  document.getElementById('totalContributors').textContent = data.contributors.length;
  document.getElementById('totalAnomalies').textContent = data.anomalies.length;
  document.getElementById('repoPath').textContent = currentRepoPath.split(/[/\\]/).pop();
  
  renderPieChart(data.commitTypes);
  renderHeatmap(data.heatmapData);
  renderTimeline(data.timelineData);
  renderContributors(data.contributors);
  renderAnomalies(data.anomalies);
  renderRelationships(data.relationships);
  renderRelatedGroups(data.relationships.groups);
}

function renderPieChart(commitTypes) {
  const container = document.getElementById('pieChart');
  container.innerHTML = '';
  
  const width = 350;
  const height = 280;
  const radius = Math.min(width, height) / 2 - 20;
  
  const svg = d3.select('#pieChart')
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .append('g')
    .attr('transform', `translate(${width / 2 - 40}, ${height / 2})`);
  
  const pie = d3.pie()
    .value(d => d.count)
    .sort(null);
  
  const arc = d3.arc()
    .innerRadius(radius * 0.5)
    .outerRadius(radius);
  
  const arcs = svg.selectAll('.arc')
    .data(pie(commitTypes))
    .enter()
    .append('g')
    .attr('class', 'arc');
  
  arcs.append('path')
    .attr('d', arc)
    .attr('fill', d => d.data.color)
    .attr('stroke', 'white')
    .attr('stroke-width', 2)
    .on('mouseover', function(event, d) {
      d3.select(this).attr('opacity', 0.8);
      showTooltip(event, `${d.data.label}: ${d.data.count} (${((d.data.count / commitTypes.reduce((a, b) => a + b.count, 0)) * 100).toFixed(1)}%)`);
    })
    .on('mouseout', function() {
      d3.select(this).attr('opacity', 1);
      hideTooltip();
    });
  
  const legend = d3.select('#pieChart')
    .select('svg')
    .append('g')
    .attr('transform', `translate(${width - 100}, 20)`);
  
  commitTypes.forEach((type, i) => {
    const legendItem = legend.append('g')
      .attr('transform', `translate(0, ${i * 25})`);
    
    legendItem.append('rect')
      .attr('width', 12)
      .attr('height', 12)
      .attr('fill', type.color);
    
    legendItem.append('text')
      .attr('x', 20)
      .attr('y', 10)
      .text(type.label)
      .style('font-size', '12px')
      .style('fill', '#333');
  });
}

function renderHeatmap(heatmapData) {
  const container = document.getElementById('heatmapChart');
  container.innerHTML = '';
  
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  
  const margin = { top: 30, right: 30, bottom: 50, left: 50 };
  const width = 550 - margin.left - margin.right;
  const height = 250 - margin.top - margin.bottom;
  
  const svg = d3.select('#heatmapChart')
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);
  
  const x = d3.scaleBand()
    .domain(hours)
    .range([0, width])
    .padding(0.05);
  
  const y = d3.scaleBand()
    .domain(days)
    .range([0, height])
    .padding(0.05);
  
  const maxValue = d3.max(heatmapData, d => d.value);
  const colorScale = d3.scaleLinear()
    .domain([0, maxValue / 2, maxValue])
    .range(['#f3f4f6', '#667eea', '#764ba2']);
  
  svg.append('g')
    .attr('transform', `translate(0, ${height})`)
    .call(d3.axisBottom(x).tickValues(hours.filter((_, i) => i % 3 === 0)))
    .selectAll('text')
    .style('font-size', '10px');
  
  svg.append('g')
    .call(d3.axisLeft(y))
    .selectAll('text')
    .style('font-size', '10px');
  
  svg.selectAll()
    .data(heatmapData)
    .enter()
    .append('rect')
    .attr('x', d => x(d.hour))
    .attr('y', d => y(d.day))
    .attr('width', x.bandwidth())
    .attr('height', y.bandwidth())
    .attr('fill', d => colorScale(d.value))
    .attr('rx', 2)
    .on('mouseover', function(event, d) {
      d3.select(this).attr('stroke', '#333').attr('stroke-width', 1);
      showTooltip(event, `${d.day} ${d.hour}:00 - ${d.value} 次提交`);
    })
    .on('mouseout', function() {
      d3.select(this).attr('stroke', 'none');
      hideTooltip();
    });
}

function renderTimeline(timelineData) {
  const container = document.getElementById('timelineChart');
  container.innerHTML = '';
  
  const margin = { top: 20, right: 30, bottom: 50, left: 60 };
  const width = 1100 - margin.left - margin.right;
  const height = 280 - margin.top - margin.bottom;
  
  const svg = d3.select('#timelineChart')
    .append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);
  
  const x = d3.scaleBand()
    .domain(timelineData.map(d => d.date))
    .range([0, width])
    .padding(0.2);
  
  const y = d3.scaleLinear()
    .domain([0, d3.max(timelineData, d => d.commits)])
    .range([height, 0]);
  
  svg.append('g')
    .attr('transform', `translate(0, ${height})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => i % Math.ceil(timelineData.length / 12) === 0)))
    .selectAll('text')
    .style('font-size', '10px')
    .attr('transform', 'rotate(-45)')
    .style('text-anchor', 'end');
  
  svg.append('g')
    .call(d3.axisLeft(y))
    .selectAll('text')
    .style('font-size', '10px');
  
  svg.selectAll('.bar')
    .data(timelineData)
    .enter()
    .append('rect')
    .attr('class', 'bar')
    .attr('x', d => x(d.date))
    .attr('y', d => y(d.commits))
    .attr('width', x.bandwidth())
    .attr('height', d => height - y(d.commits))
    .attr('fill', 'url(#gradient)')
    .attr('rx', 2)
    .on('mouseover', function(event, d) {
      d3.select(this).attr('opacity', 0.8);
      showTooltip(event, `${d.date}: ${d.commits} 次提交, +${d.insertions} 行, -${d.deletions} 行`);
    })
    .on('mouseout', function() {
      d3.select(this).attr('opacity', 1);
      hideTooltip();
    });
  
  const gradient = svg.append('defs')
    .append('linearGradient')
    .attr('id', 'gradient')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '0%')
    .attr('y2', '100%');
  
  gradient.append('stop')
    .attr('offset', '0%')
    .attr('stop-color', '#667eea');
  
  gradient.append('stop')
    .attr('offset', '100%')
    .attr('stop-color', '#764ba2');
}

function renderContributors(contributors) {
  const container = document.getElementById('contributorsList');
  container.innerHTML = '';
  
  if (contributors.length === 0) {
    container.innerHTML = '<p style="color: #999; text-align: center;">暂无贡献者数据</p>';
    return;
  }
  
  contributors.forEach(contributor => {
    const item = document.createElement('div');
    item.className = 'contributor-item';
    item.innerHTML = `
      <div class="contributor-info">
        <div class="contributor-name">${sanitizeDisplayString(contributor.name)}</div>
        <div class="contributor-email">${sanitizeDisplayString(contributor.email)}</div>
      </div>
      <div class="contributor-stats">
        <div class="contributor-commits">${contributor.commits} 次提交</div>
        <div style="font-size: 11px; color: #666;">+${contributor.insertions} / -${contributor.deletions}</div>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderAnomalies(anomalies) {
  const container = document.getElementById('anomaliesList');
  container.innerHTML = '';
  
  if (anomalies.length === 0) {
    container.innerHTML = '<p style="color: #52c41a; text-align: center;">🎉 未检测到异常提交模式</p>';
    return;
  }
  
  const displayAnomalies = anomalies.slice(0, 10);
  
  displayAnomalies.forEach(anomaly => {
    const item = document.createElement('div');
    item.className = `anomaly-item ${anomaly.severity}`;
    item.innerHTML = `
      <div class="anomaly-message">${sanitizeDisplayString(anomaly.message)}</div>
      <div class="anomaly-description">${sanitizeDisplayString(anomaly.description)}</div>
    `;
    container.appendChild(item);
  });
  
  if (anomalies.length > 10) {
    const more = document.createElement('div');
    more.style.cssText = 'text-align: center; color: #666; font-size: 12px; margin-top: 10px;';
    more.textContent = `还有 ${anomalies.length - 10} 条异常...`;
    container.appendChild(more);
  }
}

function showTooltip(event, text) {
  let tooltip = document.querySelector('.tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    document.body.appendChild(tooltip);
  }
  tooltip.textContent = text;
  tooltip.style.display = 'block';
  tooltip.style.left = (event.pageX + 10) + 'px';
  tooltip.style.top = (event.pageY - 10) + 'px';
}

function hideTooltip() {
  const tooltip = document.querySelector('.tooltip');
  if (tooltip) {
    tooltip.style.display = 'none';
  }
}

function getTypeColor(type) {
  const colors = {
    feat: '#52c41a',
    fix: '#f5222d',
    docs: '#1890ff',
    style: '#faad14',
    refactor: '#722ed1',
    test: '#13c2c2',
    chore: '#fa8c16',
    perf: '#eb2f96',
    ci: '#2f54eb',
    revert: '#8c8c8c',
    other: '#8c8c8c'
  };
  return colors[type] || '#8c8c8c';
}

function renderRelationships(relationships) {
  const container = document.getElementById('networkChart');
  container.innerHTML = '';
  
  document.getElementById('relationshipStats').textContent = 
    `(发现 ${relationships.totalRelationships} 个关联关系, ${relationships.groups.length} 个分组)`;
  
  const width = container.offsetWidth;
  const height = 500;
  
  const svg = d3.select('#networkChart')
    .append('svg')
    .attr('width', width)
    .attr('height', height);
  
  const nodes = relationships.nodes.map(d => ({...d}));
  const links = relationships.links.map(d => ({...d}));
  
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(30));
  
  const link = svg.append('g')
    .selectAll('line')
    .data(links)
    .enter()
    .append('line')
    .attr('class', 'link')
    .attr('stroke-width', d => Math.max(1, d.similarity * 3))
    .attr('stroke', d => d3.interpolateViridis(d.similarity))
    .on('click', function(event, d) {
      showLinkDetail(d, nodes);
    });
  
  const node = svg.append('g')
    .selectAll('g')
    .data(nodes)
    .enter()
    .append('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended));
  
  node.append('circle')
    .attr('r', 12)
    .attr('fill', d => getTypeColor(d.type))
    .attr('stroke', '#fff')
    .attr('stroke-width', 2);
  
  node.append('text')
    .text(d => d.shortHash)
    .attr('text-anchor', 'middle')
    .attr('dy', 4)
    .attr('fill', '#fff')
    .attr('font-size', '9px');
  
  node.on('mouseover', function(event, d) {
    showTooltip(event, `${d.message}\n作者: ${d.author}\n${new Date(d.date).toLocaleString()}`);
  }).on('mouseout', hideTooltip);
  
  node.on('click', function(event, d) {
    showCommitDetail(d);
  });
  
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
  
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }
  
  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }
  
  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }
}

function renderRelatedGroups(groups) {
  const container = document.getElementById('relatedGroups');
  container.innerHTML = '';
  
  if (groups.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">未发现关联提交分组</p>';
    return;
  }
  
  groups.forEach(group => {
    const groupCard = document.createElement('div');
    groupCard.className = 'group-card';
    groupCard.innerHTML = `
      <div class="group-header">
        <div class="group-title">
          <span class="group-tag">分组 #${group.id}</span>
          ${sanitizeDisplayString(group.suggestedLabel)}
        </div>
        <div class="group-stats">
          <span>${group.size} 个提交</span>
          <span>相似度: ${(group.avgSimilarity * 100).toFixed(1)}%</span>
        </div>
      </div>
      <div class="group-commits">
        ${group.commits.map(commit => `
          <div class="group-commit-item" onclick="showCommitDetail(${JSON.stringify({
            id: commit.hash,
            shortHash: commit.hash.substring(0, 7),
            message: commit.message,
            author: commit.author_name,
            date: commit.date
          }).replace(/"/g, '&quot;')})">
            <span class="group-commit-message">${sanitizeDisplayString(commit.message)}</span>
            <span class="group-commit-hash">${commit.hash.substring(0, 7)}</span>
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(groupCard);
  });
}

function showLinkDetail(link, nodes) {
  const source = nodes.find(n => n.id === link.source);
  const target = nodes.find(n => n.id === link.target);
  
  const modal = document.getElementById('detailModal');
  document.getElementById('modalTitle').textContent = '提交相似度详情';
  
  const similarityHtml = `
    <div class="similarity-detail">
      <div class="similarity-score">${(link.similarity * 100).toFixed(1)}% 相似</div>
      <div class="similarity-breakdown">
        <div class="similarity-item">
          <span>消息相似度</span>
          <strong>${(link.details.messageSimilarity * 100).toFixed(1)}%</strong>
        </div>
        <div class="similarity-item">
          <span>关键词相似度</span>
          <strong>${(link.details.keywordSimilarity * 100).toFixed(1)}%</strong>
        </div>
        <div class="similarity-item">
          <span>作者匹配</span>
          <strong>${link.details.authorSimilarity > 0 ? '是' : '否'}</strong>
        </div>
        <div class="similarity-item">
          <span>时间临近</span>
          <strong>${(link.details.timeSimilarity * 100).toFixed(1)}%</strong>
        </div>
      </div>
      ${link.details.commonKeywords.length > 0 ? `
        <div style="margin-top: 10px; font-size: 12px; color: #666;">
          共同关键词: ${link.details.commonKeywords.join(', ')}
        </div>
      ` : ''}
    </div>
  `;
  
  const compareHtml = `
    <div class="commit-compare">
      <div class="commit-card">
        <div class="commit-header">
          <span class="commit-hash">${source.shortHash}</span>
          <span class="commit-date">${new Date(source.date).toLocaleString()}</span>
        </div>
        <div class="commit-message">${sanitizeDisplayString(source.message)}</div>
        <div class="commit-author">${sanitizeDisplayString(source.author)}</div>
      </div>
      <div class="commit-card">
        <div class="commit-header">
          <span class="commit-hash">${target.shortHash}</span>
          <span class="commit-date">${new Date(target.date).toLocaleString()}</span>
        </div>
        <div class="commit-message">${sanitizeDisplayString(target.message)}</div>
        <div class="commit-author">${sanitizeDisplayString(target.author)}</div>
      </div>
    </div>
  `;
  
  document.getElementById('similarityDetails').innerHTML = similarityHtml;
  document.getElementById('commitCompare').innerHTML = compareHtml;
  
  modal.classList.add('active');
}

function showCommitDetail(commit) {
  const modal = document.getElementById('detailModal');
  document.getElementById('modalTitle').textContent = '提交详情';
  
  const similarityHtml = '';
  const compareHtml = `
    <div class="commit-card" style="grid-column: 1 / -1;">
      <div class="commit-header">
        <span class="commit-hash">${commit.shortHash}</span>
        <span class="commit-date">${new Date(commit.date).toLocaleString()}</span>
      </div>
      <div class="commit-message">${sanitizeDisplayString(commit.message)}</div>
      <div class="commit-author">作者: ${sanitizeDisplayString(commit.author)}</div>
    </div>
  `;
  
  document.getElementById('similarityDetails').innerHTML = similarityHtml;
  document.getElementById('commitCompare').innerHTML = compareHtml;
  
  modal.classList.add('active');
}

function closeModal() {
  document.getElementById('detailModal').classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('selectRepoBtn').addEventListener('click', selectRepo);
  document.getElementById('refreshBtn').addEventListener('click', refreshRepo);
  
  const thresholdSlider = document.getElementById('similarityThreshold');
  const thresholdValue = document.getElementById('thresholdValue');
  if (thresholdSlider) {
    thresholdSlider.addEventListener('input', (e) => {
      thresholdValue.textContent = e.target.value;
    });
  }
  
  const displayMode = document.getElementById('displayMode');
  if (displayMode) {
    displayMode.addEventListener('change', (e) => {
      const networkChart = document.getElementById('networkChart');
      const groupsView = document.getElementById('groupsView');
      if (e.target.value === 'network') {
        networkChart.style.display = 'block';
        groupsView.style.display = 'none';
      } else {
        networkChart.style.display = 'none';
        groupsView.style.display = 'block';
      }
    });
  }
});
