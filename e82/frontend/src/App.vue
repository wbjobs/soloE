<template>
  <div class="app-container">
    <header class="app-header">
      <h1>分布式调度系统 - 仲裁日志分析工具</h1>
      <p class="subtitle">Raft 协议投票可视化与脑裂检测</p>
    </header>

    <div class="control-panel">
      <div class="control-group">
        <h3>数据生成</h3>
        <div class="input-row">
          <label>节点数:
            <input type="number" v-model.number="nodeCount" min="1" max="10" />
          </label>
          <label>Term 数:
            <input type="number" v-model.number="termCount" min="1" max="100" />
          </label>
          <label>脑裂概率:
            <input type="number" v-model.number="brainSplitRate" min="0" max="1" step="0.1" />
          </label>
        </div>
        <div class="button-row">
          <button @click="generateSimulatedData" :disabled="loading">生成模拟数据</button>
          <button @click="toggleStream" :class="{ active: isStreaming }">
            {{ isStreaming ? '停止实时流' : '开始实时流' }}
          </button>
        </div>
      </div>

      <div class="control-group">
        <h3>文件上传</h3>
        <div class="upload-area">
          <input type="file" ref="fileInput" @change="handleFileUpload" accept=".jsonl,.json" />
          <button @click="triggerFileUpload">上传日志文件</button>
          <span v-if="fileName" class="file-name">{{ fileName }}</span>
        </div>
      </div>

      <div class="control-group offline-group">
        <h3>节点离线模拟</h3>
        <div class="input-row">
          <label>离线节点 ID:
            <input type="text" v-model="offlineNode" placeholder="如: A" maxlength="1" />
          </label>
          <label>离线时长 (Term):
            <input type="number" v-model.number="offlineDuration" min="1" max="20" />
          </label>
          <label>起始 Term:
            <input type="number" v-model.number="offlineStartTerm" min="1" />
          </label>
        </div>
        <div class="offline-hint">
          <span v-if="offlineNode" class="offline-status">
            📡 节点 {{ offlineNode }} 将在 Term {{ offlineStartTerm }} - {{ offlineStartTerm + offlineDuration - 1 }} 期间离线
          </span>
          <span v-else class="offline-hint-text">
            填写节点 ID 启用离线模拟，离线期间脑裂概率提升至 80%
          </span>
        </div>
      </div>
    </div>

    <div v-if="analysisResult" class="stats-panel">
      <div class="stat-card">
        <div class="stat-value">{{ analysisResult.total_terms }}</div>
        <div class="stat-label">总 Term 数</div>
      </div>
      <div class="stat-card critical">
        <div class="stat-value">{{ analysisResult.brain_split_count }}</div>
        <div class="stat-label">脑裂风险</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-value">{{ analysisResult.invalid_count }}</div>
        <div class="stat-label">无效选举</div>
      </div>
      <div v-if="analysisResult.offline_sim" class="stat-card offline">
        <div class="stat-value">{{ analysisResult.offline_sim.affected_terms.length }}</div>
        <div class="stat-label">受离线影响</div>
      </div>
    </div>

    <div v-if="analysisResult && analysisResult.offline_sim" class="offline-alert">
      <span class="alert-icon">📡</span>
      <span>节点 {{ analysisResult.offline_sim.offline_node }} 离线期间 (Term {{ analysisResult.offline_sim.offline_start }} - {{ analysisResult.offline_sim.offline_end }})，受影响 Term: {{ analysisResult.offline_sim.affected_terms.join(', ') }}</span>
    </div>

    <div v-if="analysisResult && analysisResult.risk_terms.length > 0" class="risk-alert">
      <span class="alert-icon">⚠️</span>
      <span>检测到脑裂风险 Term: {{ analysisResult.risk_terms.join(', ') }}</span>
    </div>

    <div class="chart-container">
      <h3>Term 投票分布桑基图</h3>
      <div ref="chartRef" class="chart"></div>
    </div>

    <div v-if="analysisResult" class="terms-list">
      <h3>Term 详细信息</h3>
      <div class="terms-grid">
        <div
          v-for="term in sortedTerms"
          :key="term.term"
          class="term-card"
          :class="{
            'risk-critical': term.risk_level === 'critical',
            'risk-warning': term.risk_level === 'warning',
            'affected-by-offline': term.affected_by_offline
          }"
        >
          <div class="term-header">
            <span class="term-number">
              Term {{ term.term }}
              <span v-if="term.affected_by_offline" class="offline-tag" title="受离线影响">📡</span>
            </span>
            <span class="term-badge" :class="term.risk_level">{{ term.risk_level }}</span>
          </div>
          <div class="term-votes">
            <div v-for="(count, node) in term.votes" :key="node" class="vote-item">
              <span class="node-id">节点 {{ node }}</span>
              <span class="vote-count">{{ count }} 票</span>
            </div>
          </div>
          <div v-if="term.winner" class="term-winner">
            胜者: 节点 {{ term.winner }} ({{ term.votes[term.winner] }} 票)
          </div>
          <div v-if="term.has_brain_split" class="brain-split-indicator">
            🚨 脑裂检测: 多个节点同时获得选票
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import * as echarts from 'echarts'
import axios from 'axios'

const nodeCount = ref(3)
const termCount = ref(10)
const brainSplitRate = ref(0.2)
const offlineNode = ref('')
const offlineDuration = ref(3)
const offlineStartTerm = ref(5)
const loading = ref(false)
const isStreaming = ref(false)
const fileName = ref('')
const analysisResult = ref(null)
const allLogs = ref([])
const chartRef = ref(null)
const fileInput = ref(null)
let chartInstance = null
let eventSource = null

const sortedTerms = computed(() => {
  if (!analysisResult.value) return []
  return [...analysisResult.value.terms].sort((a, b) => a.term - b.term)
})

onMounted(() => {
  nextTick(() => {
    if (chartRef.value) {
      chartInstance = echarts.init(chartRef.value)
      window.addEventListener('resize', handleResize)
    }
  })
})

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose()
  }
  window.removeEventListener('resize', handleResize)
  if (eventSource) {
    eventSource.close()
  }
})

const handleResize = () => {
  if (chartInstance) {
    chartInstance.resize()
  }
}

const sortLogsByTimestamp = (logs) => {
  return [...logs].sort((a, b) => {
    if (a.term !== b.term) {
      return a.term - b.term
    }
    return a.timestamp - b.timestamp
  })
}

const triggerFileUpload = () => {
  fileInput.value.click()
}

const handleFileUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  fileName.value = file.name
  loading.value = true

  try {
    const formData = new FormData()
    formData.append('file', file)

    const response = await axios.post('/api/analyze', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })

    analysisResult.value = response.data
    updateChart()
  } catch (error) {
    console.error('File upload error:', error)
    alert('文件上传失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const generateSimulatedData = async () => {
  loading.value = true
  try {
    const params = {
      node_count: nodeCount.value,
      term_count: termCount.value,
      brain_split_rate: brainSplitRate.value
    }
    if (offlineNode.value.trim()) {
      params.offline_node = offlineNode.value.trim().toUpperCase()
      params.offline_duration = offlineDuration.value
      params.offline_start_term = offlineStartTerm.value
    }

    const response = await axios.get('/api/simulate', {
      params,
      responseType: 'text'
    })

    const lines = response.data.trim().split('\n')
    const logs = lines.map(line => JSON.parse(line))
    allLogs.value = sortLogsByTimestamp(logs)

    const analyzeResponse = await axios.post('/api/analyze', logs)
    analysisResult.value = analyzeResponse.data
    updateChart()
  } catch (error) {
    console.error('Simulation error:', error)
    alert('生成模拟数据失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const toggleStream = () => {
  if (isStreaming.value) {
    stopStream()
  } else {
    startStream()
  }
}

const startStream = () => {
  isStreaming.value = true
  allLogs.value = []
  analysisResult.value = null

  let url = `/api/stream?node_count=${nodeCount.value}&brain_split_rate=${brainSplitRate.value}`
  if (offlineNode.value.trim()) {
    url += `&offline_node=${offlineNode.value.trim().toUpperCase()}&offline_duration=${offlineDuration.value}&offline_start_term=${offlineStartTerm.value}`
  }
  eventSource = new EventSource(url)

  eventSource.addEventListener('log', (event) => {
    const data = JSON.parse(event.data)
    allLogs.value = sortLogsByTimestamp([...allLogs.value, ...data.logs])

    if (data.analysis && data.analysis.terms) {
      if (!analysisResult.value) {
        analysisResult.value = {
          terms: [],
          total_terms: 0,
          brain_split_count: 0,
          invalid_count: 0,
          risk_terms: [],
          offline_sim: null
        }
      }

      const newTerm = data.analysis.terms[0]
      if (newTerm) {
        analysisResult.value.terms.push(newTerm)
        analysisResult.value.total_terms++
        if (newTerm.has_brain_split) {
          analysisResult.value.brain_split_count++
          analysisResult.value.risk_terms.push(newTerm.term)
        }
        if (!newTerm.is_valid) {
          analysisResult.value.invalid_count++
        }
        if (data.analysis.offline_sim) {
          analysisResult.value.offline_sim = data.analysis.offline_sim
        } else if (newTerm.affected_by_offline && offlineNode.value.trim()) {
          if (!analysisResult.value.offline_sim) {
            analysisResult.value.offline_sim = {
              offline_node: offlineNode.value.trim().toUpperCase(),
              offline_start_term: offlineStartTerm.value,
              offline_end_term: offlineStartTerm.value + offlineDuration.value - 1,
              affected_terms: []
            }
          }
          if (!analysisResult.value.offline_sim.affected_terms.includes(newTerm.term)) {
            analysisResult.value.offline_sim.affected_terms.push(newTerm.term)
          }
        }
      }

      updateChart()
    }
  })

  eventSource.onerror = () => {
    stopStream()
  }
}

const stopStream = () => {
  isStreaming.value = false
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

const updateChart = () => {
  if (!chartInstance || !analysisResult.value) return

  const terms = sortedTerms.value
  const nodes = []
  const links = []
  const nodeSet = new Set()

  terms.forEach((term, termIndex) => {
    const termNodeName = `Term ${term.term}`
    if (!nodeSet.has(termNodeName)) {
      nodeSet.add(termNodeName)
      nodes.push({
        name: termNodeName,
        itemStyle: {
          color: term.risk_level === 'critical' ? '#ff4757' :
                 term.risk_level === 'warning' ? '#ffa502' : '#3742fa'
        }
      })
    }

    Object.entries(term.votes).forEach(([nodeId, count]) => {
      const nodeName = `节点 ${nodeId}`
      if (!nodeSet.has(nodeName)) {
        nodeSet.add(nodeName)
        nodes.push({
          name: nodeName,
          itemStyle: { color: getNodeColor(nodeId) }
        })
      }

      const isAffected = term.affected_by_offline
      const linkColor = isAffected ? '#feca57' :
                        term.risk_level === 'critical' ? '#ff6b81' :
                        term.risk_level === 'warning' ? '#ffbe76' : '#70a1ff'

      links.push({
        source: termNodeName,
        target: nodeName,
        value: count,
        lineStyle: {
          color: linkColor,
          opacity: isAffected ? 0.7 : (term.risk_level === 'critical' ? 0.8 : 0.5),
          type: isAffected ? 'dashed' : 'solid',
          width: isAffected ? 2 : 1
        }
      })
    })
  })

  const option = {
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      textStyle: { color: '#fff' }
    },
    series: [{
      type: 'sankey',
      layout: 'none',
      emphasis: {
        focus: 'adjacency'
      },
      nodeAlign: 'left',
      data: nodes,
      links: links,
      lineStyle: {
        curveness: 0.5
      },
      label: {
        color: '#fff',
        fontSize: 12
      }
    }]
  }

  chartInstance.setOption(option, true)
}

const getNodeColor = (nodeId) => {
  const colors = {
    'A': '#00d2d3',
    'B': '#54a0ff',
    'C': '#5f27cd',
    'D': '#ff9ff3',
    'E': '#feca57',
    'F': '#ff6b6b',
    'G': '#48dbfb',
    'H': '#1dd1a1',
    'I': '#ee5a24',
    'J': '#9980fa'
  }
  return colors[nodeId] || '#747d8c'
}
</script>

<style scoped>
.app-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.app-header {
  text-align: center;
  margin-bottom: 30px;
  padding: 20px;
}

.app-header h1 {
  font-size: 2rem;
  margin-bottom: 10px;
  background: linear-gradient(90deg, #00d2d3, #54a0ff, #5f27cd);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.subtitle {
  color: #a4b0be;
  font-size: 1rem;
}

.control-panel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.control-group {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.control-group h3 {
  margin-bottom: 15px;
  color: #00d2d3;
}

.input-row {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
  margin-bottom: 15px;
}

.input-row label {
  display: flex;
  flex-direction: column;
  font-size: 0.85rem;
  color: #a4b0be;
  gap: 5px;
}

.input-row input {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  padding: 8px 12px;
  color: #fff;
  width: 100px;
}

.button-row {
  display: flex;
  gap: 10px;
}

button {
  background: linear-gradient(135deg, #54a0ff, #5f27cd);
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  color: #fff;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.3s ease;
}

button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(84, 160, 255, 0.4);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.active {
  background: linear-gradient(135deg, #ff4757, #ff6b81);
}

.upload-area {
  display: flex;
  align-items: center;
  gap: 15px;
}

.upload-area input[type="file"] {
  display: none;
}

.file-name {
  color: #a4b0be;
  font-size: 0.9rem;
}

.stats-panel {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
}

.stat-card {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.stat-card.critical {
  border-color: rgba(255, 71, 87, 0.5);
  background: rgba(255, 71, 87, 0.1);
}

.stat-card.warning {
  border-color: rgba(255, 165, 2, 0.5);
  background: rgba(255, 165, 2, 0.1);
}

.stat-card.offline {
  border-color: rgba(254, 202, 87, 0.5);
  background: rgba(254, 202, 87, 0.1);
}

.stat-card.offline .stat-value {
  color: #feca57;
}

.stat-value {
  font-size: 2.5rem;
  font-weight: bold;
  color: #00d2d3;
  margin-bottom: 5px;
}

.stat-card.critical .stat-value {
  color: #ff4757;
}

.stat-card.warning .stat-value {
  color: #ffa502;
}

.stat-label {
  color: #a4b0be;
  font-size: 0.9rem;
}

.risk-alert {
  background: rgba(255, 71, 87, 0.15);
  border: 1px solid rgba(255, 71, 87, 0.5);
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.offline-alert {
  background: rgba(254, 202, 87, 0.15);
  border: 1px solid rgba(254, 202, 87, 0.5);
  border-radius: 8px;
  padding: 15px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #feca57;
}

.offline-hint {
  margin-top: 10px;
  font-size: 0.85rem;
}

.offline-status {
  color: #feca57;
}

.offline-hint-text {
  color: #a4b0be;
}

.offline-group {
  border-color: rgba(254, 202, 87, 0.3);
}

.offline-group h3 {
  color: #feca57;
}

.offline-tag {
  margin-left: 5px;
  font-size: 0.9rem;
}

.alert-icon {
  font-size: 1.5rem;
}

.chart-container {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.chart-container h3 {
  margin-bottom: 15px;
  color: #00d2d3;
}

.chart {
  height: 500px;
  width: 100%;
}

.terms-list {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.terms-list h3 {
  margin-bottom: 15px;
  color: #00d2d3;
}

.terms-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 15px;
}

.term-card {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 15px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;
}

.term-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
}

.term-card.risk-critical {
  border-color: rgba(255, 71, 87, 0.6);
  background: rgba(255, 71, 87, 0.1);
}

.term-card.risk-warning {
  border-color: rgba(255, 165, 2, 0.6);
  background: rgba(255, 165, 2, 0.1);
}

.term-card.affected-by-offline {
  border-color: rgba(254, 202, 87, 0.6);
  background: rgba(254, 202, 87, 0.1);
}

.term-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.term-number {
  font-weight: bold;
  font-size: 1.1rem;
}

.term-badge {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  text-transform: uppercase;
}

.term-badge.normal {
  background: rgba(0, 210, 211, 0.2);
  color: #00d2d3;
}

.term-badge.warning {
  background: rgba(255, 165, 2, 0.2);
  color: #ffa502;
}

.term-badge.critical {
  background: rgba(255, 71, 87, 0.2);
  color: #ff4757;
}

.term-votes {
  margin-bottom: 10px;
}

.vote-item {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 0.9rem;
  color: #dfe4ea;
}

.node-id {
  color: #a4b0be;
}

.term-winner {
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 0.9rem;
  color: #00d2d3;
}

.brain-split-indicator {
  margin-top: 8px;
  padding: 8px;
  background: rgba(255, 71, 87, 0.2);
  border-radius: 4px;
  font-size: 0.85rem;
  color: #ff4757;
}

@media (max-width: 768px) {
  .control-panel {
    grid-template-columns: 1fr;
  }

  .stats-panel {
    grid-template-columns: 1fr;
  }

  .terms-grid {
    grid-template-columns: 1fr;
  }

  .chart {
    height: 300px;
  }
}
</style>
