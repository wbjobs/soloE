<template>
  <div class="app-container">
    <header class="header">
      <h1>粮仓害虫检测系统</h1>
      <p>上传音频文件检测害虫活动</p>
    </header>

    <main class="main-content">
      <el-tabs v-model="activeTab" class="main-tabs">
        <el-tab-pane label="单文件检测" name="detect">
          <div class="upload-section">
            <el-card title="音频上传" class="upload-card">
              <div class="upload-form">
                <el-form-item label="选择粮仓">
                  <el-select v-model="selectedGranary" placeholder="请选择粮仓" style="width: 100%">
                    <el-option v-for="g in granaryList" :key="g" :label="g" :value="g"></el-option>
                    <el-option label="自定义粮仓" value="custom"></el-option>
                  </el-select>
                </el-form-item>
                <el-form-item v-if="selectedGranary === 'custom'">
                  <el-input v-model="customGranary" placeholder="请输入自定义粮仓ID"></el-input>
                </el-form-item>
              </div>
              <div class="upload-area" @click="triggerUpload" @dragover.prevent @drop.prevent="handleDrop">
                <input ref="fileInput" type="file" accept="audio/*" @change="handleFileSelect" class="file-input">
                <div v-if="!selectedFile" class="upload-hint">
                  <el-icon size="48" class="upload-icon">Upload</el-icon>
                  <p>点击或拖拽音频文件到此处</p>
                  <p class="hint-text">支持格式：WAV、MP3、FLAC、OGG，文件大小不超过 10MB</p>
                </div>
                <div v-else class="file-info">
                  <el-icon size="24">File</el-icon>
                  <span>{{ selectedFile.name }}</span>
                  <el-button size="small" @click="clearFile">清除</el-button>
                </div>
              </div>
              <el-button type="primary" :disabled="!selectedFile || isLoading" @click="uploadFile" class="upload-btn">
                <span v-if="isLoading">检测中...</span>
                <span v-else>开始检测</span>
              </el-button>
            </el-card>
          </div>

          <div class="result-section" v-if="detectionResult">
            <el-card title="检测结果" class="result-card">
              <div class="result-content">
                <div class="spectrogram-container">
                  <h3>声谱图</h3>
                  <img :src="'data:image/png;base64,' + detectionResult.spectrogram" alt="声谱图" class="spectrogram">
                </div>
                <div class="confidence-container">
                  <h3>识别结果</h3>
                  <div class="result-badge" :class="detectionResult.is_pest ? 'pest' : 'safe'">
                    {{ detectionResult.is_pest ? '检测到害虫活动' : '未检测到害虫活动' }}
                  </div>
                  <div class="confidence-bar">
                    <span>置信度：</span>
                    <el-progress :percentage="detectionResult.pest_confidence" :color="confidenceColor"></el-progress>
                    <span class="confidence-value">{{ detectionResult.pest_confidence.toFixed(2) }}%</span>
                  </div>
                  <div class="file-info-small">
                    <p>文件名：{{ detectionResult.filename }}</p>
                    <p>粮仓：{{ detectionResult.granary_id }}</p>
                    <p>检测时间：{{ formatTime(detectionResult.created_at) }}</p>
                  </div>
                </div>
              </div>
            </el-card>
          </div>
        </el-tab-pane>

        <el-tab-pane label="多粮仓对比分析" name="compare">
          <el-card title="多粮仓对比分析" class="compare-card">
            <div class="compare-controls">
              <div class="control-group">
                <label>选择粮仓（最多3个）：</label>
                <el-checkbox-group v-model="selectedGranaries" @change="onGranaryChange">
                  <el-checkbox v-for="g in granaryList" :key="g" :label="g">{{ g }}</el-checkbox>
                </el-checkbox-group>
              </div>
              <div class="control-group">
                <label>统计天数：</label>
                <el-select v-model="statsDays" style="width: 120px">
                  <el-option :label="7 + '天'" :value="7"></el-option>
                  <el-option :label="14 + '天'" :value="14"></el-option>
                  <el-option :label="30 + '天'" :value="30"></el-option>
                </el-select>
              </div>
              <div class="control-group">
                <el-button type="primary" :disabled="selectedGranaries.length < 1 || selectedGranaries.length > 3" @click="fetchGranaryStats">
                  生成对比报告
                </el-button>
                <el-button @click="generateMockData">生成测试数据</el-button>
              </div>
            </div>

            <div class="stats-summary" v-if="granaryStats.length > 0">
              <el-row :gutter="20">
                <el-col :span="8" v-for="stat in granaryStats" :key="stat.granary_id">
                  <div class="stat-card" :class="stat.pest_count > 5 ? 'warning' : 'normal'">
                    <h4>{{ stat.granary_id }}</h4>
                    <div class="stat-value">{{ stat.pest_count }}</div>
                    <p>害虫告警次数</p>
                    <p class="stat-sub">总检测：{{ stat.total_detections }} 次</p>
                  </div>
                </el-col>
              </el-row>
            </div>

            <div class="chart-container" v-if="granaryStats.length > 0">
              <h3>各粮仓最近 {{ statsDays }} 天害虫告警趋势</h3>
              <v-chart class="chart" :option="chartOption" autoresize />
            </div>

            <div class="empty-state" v-else>
              <el-empty description="请选择粮仓并生成对比报告">
                <el-button type="primary" @click="generateMockData">生成测试数据</el-button>
              </el-empty>
            </div>
          </el-card>
        </el-tab-pane>

        <el-tab-pane label="历史记录" name="history">
          <el-card title="历史记录" class="history-card">
            <div class="pagination-top">
              <el-pagination
                v-model:current-page="currentPage"
                :page-size="pageSize"
                :total="totalRecords"
                :page-sizes="[5, 10, 20]"
                layout="total, sizes, prev, pager, next, jumper"
                @size-change="handleSizeChange"
                @current-change="handlePageChange"
              ></el-pagination>
            </div>
            <el-table :data="historyRecords" border class="history-table">
              <el-table-column prop="granary_id" label="粮仓" width="100"></el-table-column>
              <el-table-column prop="filename" label="文件名" min-width="150"></el-table-column>
              <el-table-column prop="pest_confidence" label="置信度">
                <template #default="scope">
                  <el-progress :percentage="scope.row.pest_confidence" :color="getConfidenceColor(scope.row.pest_confidence)" :show-text="false" height="8px"></el-progress>
                  <span class="conf-text">{{ scope.row.pest_confidence.toFixed(1) }}%</span>
                </template>
              </el-table-column>
              <el-table-column prop="is_pest" label="结果">
                <template #default="scope">
                  <span :class="scope.row.is_pest ? 'label-pest' : 'label-safe'">
                    {{ scope.row.is_pest ? '有害虫' : '安全' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column prop="created_at" label="检测时间" min-width="150">
                <template #default="scope">
                  {{ formatTime(scope.row.created_at) }}
                </template>
              </el-table-column>
              <el-table-column label="声谱图" width="120">
                <template #default="scope">
                  <el-image 
                    v-if="scope.row.spectrogram"
                    :src="'data:image/png;base64,' + scope.row.spectrogram" 
                    fit="cover" 
                    class="mini-spectrogram"
                    @click="showSpectrogram(scope.row)"
                  ></el-image>
                  <span v-else class="no-image">无</span>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-tab-pane>
      </el-tabs>
    </main>

    <el-dialog title="声谱图详情" :visible.sync="showSpectrogramDialog" width="800px">
      <img v-if="selectedRecord" :src="'data:image/png;base64,' + selectedRecord.spectrogram" alt="声谱图详情" class="dialog-spectrogram">
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { Upload, File } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DatasetComponent,
  TransformComponent
} from 'echarts/components'
import axios from 'axios'

use([
  CanvasRenderer,
  BarChart,
  LineChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  DatasetComponent,
  TransformComponent
])

const activeTab = ref('detect')
const fileInput = ref(null)
const selectedFile = ref(null)
const isLoading = ref(false)
const detectionResult = ref(null)
const historyRecords = ref([])
const currentPage = ref(1)
const pageSize = ref(10)
const totalRecords = ref(0)
const showSpectrogramDialog = ref(false)
const selectedRecord = ref(null)
const granaryList = ref(['粮仓A', '粮仓B', '粮仓C'])
const selectedGranary = ref('粮仓A')
const customGranary = ref('')
const selectedGranaries = ref([])
const statsDays = ref(7)
const granaryStats = ref([])
const chartOption = ref({})

const colors = ['#5470c6', '#91cc75', '#fac858']

const confidenceColor = computed(() => {
  if (!detectionResult.value) return '#67C23A'
  const conf = detectionResult.value.pest_confidence
  if (conf > 80) return '#F56C6C'
  if (conf > 50) return '#E6A23C'
  return '#67C23A'
})

const triggerUpload = () => {
  fileInput.value.click()
}

const MAX_FILE_SIZE = 10 * 1024 * 1024

const handleFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    if (file.size > MAX_FILE_SIZE) {
      ElMessage.error(`文件大小超过限制，最大支持 10MB，当前文件大小: ${(file.size / (1024 * 1024)).toFixed(2)}MB`)
      return
    }
    selectedFile.value = file
  }
}

const handleDrop = (event) => {
  const file = event.dataTransfer.files[0]
  if (file && file.type.startsWith('audio/')) {
    if (file.size > MAX_FILE_SIZE) {
      ElMessage.error(`文件大小超过限制，最大支持 10MB，当前文件大小: ${(file.size / (1024 * 1024)).toFixed(2)}MB`)
      return
    }
    selectedFile.value = file
  }
}

const clearFile = () => {
  selectedFile.value = null
  detectionResult.value = null
  fileInput.value.value = ''
}

const uploadFile = async () => {
  if (!selectedFile.value) return
  
  isLoading.value = true
  const formData = new FormData()
  formData.append('file', selectedFile.value)
  const granary = selectedGranary.value === 'custom' ? customGranary.value : selectedGranary.value
  formData.append('granary_id', granary)
  
  try {
    const response = await axios.post('/api/detect', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    detectionResult.value = response.data
    ElMessage.success('检测完成！')
    await fetchHistory()
    await fetchGranaries()
  } catch (error) {
    console.error('上传失败:', error)
    ElMessage.error(error.response?.data?.detail || '上传失败，请重试')
  } finally {
    isLoading.value = false
  }
}

const fetchHistory = async () => {
  try {
    const response = await axios.get('/api/history', {
      params: { page: currentPage.value, page_size: pageSize.value }
    })
    historyRecords.value = response.data.data
    totalRecords.value = response.data.total
  } catch (error) {
    console.error('获取历史记录失败:', error)
    ElMessage.error('获取历史记录失败')
  }
}

const fetchGranaries = async () => {
  try {
    const response = await axios.get('/api/granaries')
    granaryList.value = response.data.granaries
  } catch (error) {
    console.error('获取粮仓列表失败:', error)
  }
}

const onGranaryChange = (val) => {
  if (val.length > 3) {
    ElMessage.warning('最多只能选择3个粮仓')
    selectedGranaries.value = val.slice(0, 3)
  }
}

const fetchGranaryStats = async () => {
  if (selectedGranaries.value.length < 1 || selectedGranaries.value.length > 3) {
    ElMessage.warning('请选择 1-3 个粮仓')
    return
  }
  
  isLoading.value = true
  try {
    const response = await axios.get('/api/granary-stats', {
      params: {
        granary_ids: selectedGranaries.value.join(','),
        days: statsDays.value
      }
    })
    granaryStats.value = response.data.data
    updateChart(response.data.data)
  } catch (error) {
    console.error('获取统计数据失败:', error)
    ElMessage.error(error.response?.data?.detail || '获取统计数据失败')
  } finally {
    isLoading.value = false
  }
}

const generateMockData = async () => {
  try {
    await axios.post('/api/generate-mock-data')
    ElMessage.success('测试数据生成成功！')
    await fetchGranaries()
    await fetchHistory()
  } catch (error) {
    console.error('生成测试数据失败:', error)
    ElMessage.error('生成测试数据失败')
  }
}

const updateChart = (stats) => {
  if (!stats || stats.length === 0) return
  
  const allDates = stats[0].daily_data.map(d => d.date)
  const series = stats.map((stat, index) => ({
    name: stat.granary_id,
    type: 'bar',
    data: stat.daily_data.map(d => d.count),
    itemStyle: { color: colors[index % colors.length] },
    barMaxWidth: 40
  }))
  
  chartOption.value = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' }
    },
    legend: {
      data: stats.map(s => s.granary_id),
      bottom: 0
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      top: '10%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: allDates,
      axisLabel: {
        rotate: 45
      }
    },
    yAxis: {
      type: 'value',
      name: '告警次数',
      minInterval: 1
    },
    series: series
  }
}

const handleSizeChange = (size) => {
  pageSize.value = size
  currentPage.value = 1
  fetchHistory()
}

const handlePageChange = (page) => {
  currentPage.value = page
  fetchHistory()
}

const formatTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const getConfidenceColor = (conf) => {
  if (conf > 80) return '#F56C6C'
  if (conf > 50) return '#E6A23C'
  return '#67C23A'
}

const showSpectrogram = (record) => {
  selectedRecord.value = record
  showSpectrogramDialog.value = true
}

onMounted(() => {
  fetchHistory()
  fetchGranaries()
})
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.header {
  text-align: center;
  color: white;
  margin-bottom: 30px;
}

.header h1 {
  font-size: 2.5rem;
  margin-bottom: 10px;
  text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
}

.header p {
  font-size: 1.1rem;
  opacity: 0.9;
}

.main-content {
  max-width: 1200px;
  margin: 0 auto;
}

.main-tabs {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
}

.upload-section, .result-section, .history-section {
  margin-bottom: 30px;
}

.upload-card, .result-card, .history-card, .compare-card {
  box-shadow: none;
  border: none;
}

.upload-form {
  margin-bottom: 20px;
}

.upload-area {
  border: 2px dashed #d9d9d9;
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: #fafafa;
}

.upload-area:hover {
  border-color: #409eff;
  background: #f0f5ff;
}

.file-input {
  display: none;
}

.upload-icon {
  color: #409eff;
  margin-bottom: 15px;
}

.upload-hint p {
  margin: 8px 0;
  color: #666;
}

.hint-text {
  font-size: 0.9rem;
  color: #999 !important;
}

.file-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #333;
}

.upload-btn {
  width: 100%;
  margin-top: 20px;
  height: 48px;
  font-size: 1.1rem;
}

.result-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
}

.spectrogram-container {
  text-align: center;
}

.spectrogram {
  max-width: 100%;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.confidence-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.result-badge {
  font-size: 1.5rem;
  font-weight: bold;
  padding: 15px;
  border-radius: 10px;
  text-align: center;
  margin-bottom: 20px;
}

.result-badge.pest {
  background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
  color: white;
}

.result-badge.safe {
  background: linear-gradient(135deg, #51cf66 0%, #40c057 100%);
  color: white;
}

.confidence-bar {
  margin-bottom: 15px;
}

.confidence-bar span:first-child {
  display: block;
  margin-bottom: 8px;
  font-weight: bold;
}

.confidence-value {
  display: block;
  text-align: right;
  font-weight: bold;
  margin-top: 5px;
}

.file-info-small p {
  margin: 5px 0;
  color: #666;
  font-size: 0.9rem;
}

.compare-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 30px;
  margin-bottom: 30px;
  padding: 20px;
  background: #f5f7fa;
  border-radius: 8px;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.control-group label {
  font-weight: bold;
  color: #333;
  min-width: 80px;
}

.stats-summary {
  margin-bottom: 30px;
}

.stat-card {
  padding: 20px;
  border-radius: 12px;
  text-align: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 4px 15px rgba(0,0,0,0.1);
}

.stat-card.warning {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.stat-card h4 {
  margin: 0 0 10px 0;
  font-size: 1.1rem;
  opacity: 0.95;
}

.stat-card .stat-value {
  font-size: 3rem;
  font-weight: bold;
  line-height: 1;
  margin: 15px 0;
}

.stat-card p {
  margin: 5px 0;
  opacity: 0.9;
}

.stat-card .stat-sub {
  font-size: 0.85rem;
  opacity: 0.8;
}

.chart-container {
  margin-top: 30px;
}

.chart-container h3 {
  margin-bottom: 20px;
  color: #333;
}

.chart {
  height: 400px;
  width: 100%;
}

.empty-state {
  padding: 60px 0;
}

.pagination-top {
  text-align: right;
  margin-bottom: 15px;
}

.history-table {
  margin-top: 10px;
}

.mini-spectrogram {
  width: 80px;
  height: 40px;
  cursor: pointer;
  border-radius: 4px;
}

.no-image {
  color: #999;
  font-size: 0.85rem;
}

.label-pest {
  background: #fef0f0;
  color: #dc2626;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.85rem;
}

.label-safe {
  background: #f0fdf4;
  color: #16a34a;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.85rem;
}

.conf-text {
  margin-left: 10px;
  font-size: 0.85rem;
  color: #666;
}

.dialog-spectrogram {
  width: 100%;
  border-radius: 8px;
}

@media (max-width: 768px) {
  .result-content {
    grid-template-columns: 1fr;
  }
  
  .header h1 {
    font-size: 1.8rem;
  }
  
  .compare-controls {
    flex-direction: column;
    align-items: flex-start;
    gap: 15px;
  }
  
  .control-group {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>