<template>
  <div class="container">
    <div class="header">
      <h1>传感器数据监控系统</h1>
      <p>LoRaWAN传感器数据实时监控与可视化</p>
    </div>

    <div class="stats-grid">
      <div class="stat-card temperature">
        <div class="stat-label">温度</div>
        <div class="stat-value temperature">{{ displayValue?.temperature ?? '--' }}</div>
        <div class="stat-unit">°C</div>
      </div>
      <div class="stat-card humidity">
        <div class="stat-label">湿度</div>
        <div class="stat-value humidity">{{ displayValue?.humidity ?? '--' }}</div>
        <div class="stat-unit">%</div>
      </div>
      <div class="stat-card pressure">
        <div class="stat-label">气压</div>
        <div class="stat-value pressure">{{ displayValue?.pressure ?? '--' }}</div>
        <div class="stat-unit">kPa</div>
      </div>
    </div>

    <div class="controls">
      <button class="btn btn-primary" @click="fetchData">刷新数据</button>
      <button class="btn btn-secondary" @click="addTestData">添加测试数据</button>
      <div class="input-group">
        <label>数据条数:</label>
        <input type="number" v-model.number="limit" min="1" max="500">
      </div>
      <div class="input-group">
        <label>显示模式:</label>
        <select v-model="viewMode">
          <option value="realtime">实时数据</option>
          <option value="aggregate">日聚合数据</option>
        </select>
      </div>
      <div class="input-group" v-if="viewMode === 'aggregate'">
        <label>选择日期:</label>
        <input type="date" v-model="selectedDate" @change="fetchAggregateData">
      </div>
    </div>

    <div v-if="viewMode === 'aggregate' && aggregateData" class="aggregate-stats">
      <div class="aggregate-card">
        <h3>{{ selectedDate }} 统计概览</h3>
        <p>数据条数: {{ aggregateData.count }}</p>
      </div>
    </div>

    <div class="chart-container">
      <div class="chart-title">{{ viewMode === 'realtime' ? '温度变化趋势' : '温度日聚合' }}</div>
      <div ref="tempChart" class="chart"></div>
    </div>

    <div class="chart-container">
      <div class="chart-title">{{ viewMode === 'realtime' ? '湿度变化趋势' : '湿度日聚合' }}</div>
      <div ref="humidityChart" class="chart"></div>
    </div>

    <div class="chart-container">
      <div class="chart-title">{{ viewMode === 'realtime' ? '气压变化趋势' : '气压日聚合' }}</div>
      <div ref="pressureChart" class="chart"></div>
    </div>

    <div class="data-table">
      <h3>{{ viewMode === 'realtime' ? '历史数据记录' : '日聚合数据' }}</h3>
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="viewMode === 'realtime' && sensorData.length === 0" class="no-data">暂无数据</div>
      <div v-else-if="viewMode === 'aggregate' && !aggregateData" class="no-data">暂无数据</div>
      <table v-if="viewMode === 'realtime' && sensorData.length > 0">
        <thead>
          <tr>
            <th>ID</th>
            <th>时间</th>
            <th>温度 (°C)</th>
            <th>湿度 (%)</th>
            <th>气压 (kPa)</th>
            <th>原始Payload</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="data in sensorData.slice().reverse()" :key="data.id">
            <td>{{ data.id }}</td>
            <td>{{ formatTimestamp(data.timestamp) }}</td>
            <td>{{ data.temperature }}</td>
            <td>{{ data.humidity }}</td>
            <td>{{ data.pressure }}</td>
            <td><code>{{ data.raw_payload }}</code></td>
          </tr>
        </tbody>
      </table>
      <table v-if="viewMode === 'aggregate' && aggregateData">
        <thead>
          <tr>
            <th>指标</th>
            <th>平均值</th>
            <th>最小值</th>
            <th>最大值</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>温度 (°C)</td>
            <td>{{ aggregateData.temperature.avg }}</td>
            <td>{{ aggregateData.temperature.min }}</td>
            <td>{{ aggregateData.temperature.max }}</td>
          </tr>
          <tr>
            <td>湿度 (%)</td>
            <td>{{ aggregateData.humidity.avg }}</td>
            <td>{{ aggregateData.humidity.min }}</td>
            <td>{{ aggregateData.humidity.max }}</td>
          </tr>
          <tr>
            <td>气压 (kPa)</td>
            <td>{{ aggregateData.pressure.avg }}</td>
            <td>{{ aggregateData.pressure.min }}</td>
            <td>{{ aggregateData.pressure.max }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import axios from 'axios'
import * as echarts from 'echarts'

const sensorData = ref([])
const aggregateData = ref(null)
const loading = ref(false)
const limit = ref(100)
const viewMode = ref('realtime')
const selectedDate = ref(new Date().toISOString().split('T')[0])

const tempChart = ref(null)
const humidityChart = ref(null)
const pressureChart = ref(null)

let tempChartInstance = null
let humidityChartInstance = null
let pressureChartInstance = null

const latestData = computed(() => {
  if (sensorData.value.length > 0) {
    return sensorData.value[sensorData.value.length - 1]
  }
  return null
})

const displayValue = computed(() => {
  if (viewMode.value === 'realtime') {
    return {
      temperature: latestData.value?.temperature,
      humidity: latestData.value?.humidity,
      pressure: latestData.value?.pressure
    }
  } else if (aggregateData.value) {
    return {
      temperature: aggregateData.value.temperature.avg,
      humidity: aggregateData.value.humidity.avg,
      pressure: aggregateData.value.pressure.avg
    }
  }
  return null
})

const fetchData = async () => {
  loading.value = true
  try {
    const response = await axios.get(`/api/data?limit=${limit.value}`)
    sensorData.value = response.data
    await nextTick()
    updateCharts()
  } catch (error) {
    console.error('获取数据失败:', error)
  } finally {
    loading.value = false
  }
}

const fetchAggregateData = async () => {
  loading.value = true
  try {
    const response = await axios.get(`/api/data/aggregate?date=${selectedDate.value}`)
    aggregateData.value = response.data
    await nextTick()
    updateAggregateCharts()
  } catch (error) {
    console.error('获取聚合数据失败:', error)
  } finally {
    loading.value = false
  }
}

const addTestData = async () => {
  try {
    const temp = Math.floor((-5 + Math.random() * 30) * 100)
    const humidity = Math.floor((40 + Math.random() * 40) * 10)
    const pressure = Math.floor((95 + Math.random() * 15) * 10)
    
    const buffer = new ArrayBuffer(6)
    const view = new DataView(buffer)
    view.setInt16(0, temp, false)
    view.setUint16(2, humidity, false)
    view.setUint16(4, pressure, false)
    
    let hexPayload = ''
    for (let i = 0; i < 6; i++) {
      hexPayload += view.getUint8(i).toString(16).padStart(2, '0')
    }
    
    await axios.post('/api/data', { payload: hexPayload })
    if (viewMode.value === 'realtime') {
      await fetchData()
    } else {
      await fetchAggregateData()
    }
  } catch (error) {
    console.error('添加测试数据失败:', error)
  }
}

const formatTimestamp = (timestamp) => {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN')
}

const initCharts = () => {
  if (tempChart.value) {
    tempChartInstance = echarts.init(tempChart.value)
  }
  if (humidityChart.value) {
    humidityChartInstance = echarts.init(humidityChart.value)
  }
  if (pressureChart.value) {
    pressureChartInstance = echarts.init(pressureChart.value)
  }
}

const updateCharts = () => {
  const timestamps = sensorData.value.map(d => formatTimestamp(d.timestamp))
  const temperatures = sensorData.value.map(d => d.temperature)
  const humidities = sensorData.value.map(d => d.humidity)
  const pressures = sensorData.value.map(d => d.pressure)

  const commonOption = {
    tooltip: {
      trigger: 'axis'
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: timestamps,
      axisLabel: {
        rotate: 45,
        fontSize: 10
      }
    },
    yAxis: {
      type: 'value'
    }
  }

  if (tempChartInstance) {
    tempChartInstance.setOption({
      ...commonOption,
      yAxis: {
        ...commonOption.yAxis,
        name: '温度 (°C)'
      },
      series: [{
        name: '温度',
        type: 'line',
        data: temperatures,
        smooth: true,
        itemStyle: {
          color: '#ff6b6b'
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(255, 107, 107, 0.3)' },
            { offset: 1, color: 'rgba(255, 107, 107, 0.05)' }
          ])
        }
      }]
    })
  }

  if (humidityChartInstance) {
    humidityChartInstance.setOption({
      ...commonOption,
      yAxis: {
        ...commonOption.yAxis,
        name: '湿度 (%)'
      },
      series: [{
        name: '湿度',
        type: 'line',
        data: humidities,
        smooth: true,
        itemStyle: {
          color: '#4ecdc4'
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(78, 205, 196, 0.3)' },
            { offset: 1, color: 'rgba(78, 205, 196, 0.05)' }
          ])
        }
      }]
    })
  }

  if (pressureChartInstance) {
    pressureChartInstance.setOption({
      ...commonOption,
      yAxis: {
        ...commonOption.yAxis,
        name: '气压 (kPa)'
      },
      series: [{
        name: '气压',
        type: 'line',
        data: pressures,
        smooth: true,
        itemStyle: {
          color: '#45b7d1'
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(69, 183, 209, 0.3)' },
            { offset: 1, color: 'rgba(69, 183, 209, 0.05)' }
          ])
        }
      }]
    })
  }
}

const updateAggregateCharts = () => {
  if (!aggregateData.value) return

  const categories = ['平均值', '最小值', '最大值']
  const tempData = [
    aggregateData.value.temperature.avg,
    aggregateData.value.temperature.min,
    aggregateData.value.temperature.max
  ]
  const humidityData = [
    aggregateData.value.humidity.avg,
    aggregateData.value.humidity.min,
    aggregateData.value.humidity.max
  ]
  const pressureData = [
    aggregateData.value.pressure.avg,
    aggregateData.value.pressure.min,
    aggregateData.value.pressure.max
  ]

  const commonOption = {
    tooltip: {
      trigger: 'axis'
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      data: categories
    },
    yAxis: {
      type: 'value'
    }
  }

  if (tempChartInstance) {
    tempChartInstance.setOption({
      ...commonOption,
      yAxis: {
        ...commonOption.yAxis,
        name: '温度 (°C)'
      },
      series: [{
        name: '温度',
        type: 'bar',
        data: tempData,
        itemStyle: {
          color: function(params) {
            const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1']
            return colors[params.dataIndex]
          }
        }
      }]
    })
  }

  if (humidityChartInstance) {
    humidityChartInstance.setOption({
      ...commonOption,
      yAxis: {
        ...commonOption.yAxis,
        name: '湿度 (%)'
      },
      series: [{
        name: '湿度',
        type: 'bar',
        data: humidityData,
        itemStyle: {
          color: function(params) {
            const colors = ['#4ecdc4', '#45b7d1', '#96ceb4']
            return colors[params.dataIndex]
          }
        }
      }]
    })
  }

  if (pressureChartInstance) {
    pressureChartInstance.setOption({
      ...commonOption,
      yAxis: {
        ...commonOption.yAxis,
        name: '气压 (kPa)'
      },
      series: [{
        name: '气压',
        type: 'bar',
        data: pressureData,
        itemStyle: {
          color: function(params) {
            const colors = ['#45b7d1', '#967bb6', '#f7b731']
            return colors[params.dataIndex]
          }
        }
      }]
    })
  }
}

const handleResize = () => {
  tempChartInstance?.resize()
  humidityChartInstance?.resize()
  pressureChartInstance?.resize()
}

watch(viewMode, async (newMode) => {
  if (newMode === 'realtime') {
    await fetchData()
  } else {
    await fetchAggregateData()
  }
})

onMounted(async () => {
  await nextTick()
  initCharts()
  await fetchData()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  tempChartInstance?.dispose()
  humidityChartInstance?.dispose()
  pressureChartInstance?.dispose()
})
</script>
