<template>
  <div ref="chartRef" class="chart"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'

const chartRef = ref(null)
let chartInstance = null
let refreshInterval = null

const fetchStats = async () => {
  try {
    const response = await fetch('/api/v1/tasks/stats?minutes=60')
    const data = await response.json()
    updateChart(data.stats)
  } catch (error) {
    console.error('Failed to fetch stats:', error)
  }
}

const updateChart = (stats) => {
  if (!chartInstance) return

  const xAxisData = stats.map(item => {
    const time = item.minute.split(' ')[1]
    return time
  })
  
  const successData = stats.map(item => item.success_count)
  const failedData = stats.map(item => item.failed_count)

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross'
      }
    },
    legend: {
      data: ['成功任务', '失败任务'],
      top: 10
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '60px',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: xAxisData,
      axisLabel: {
        rotate: 45,
        fontSize: 11
      }
    },
    yAxis: {
      type: 'value',
      name: '任务数'
    },
    series: [
      {
        name: '成功任务',
        type: 'line',
        smooth: true,
        data: successData,
        itemStyle: {
          color: '#10b981'
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(16, 185, 129, 0.3)' },
            { offset: 1, color: 'rgba(16, 185, 129, 0.05)' }
          ])
        }
      },
      {
        name: '失败任务',
        type: 'line',
        smooth: true,
        data: failedData,
        itemStyle: {
          color: '#ef4444'
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(239, 68, 68, 0.3)' },
            { offset: 1, color: 'rgba(239, 68, 68, 0.05)' }
          ])
        }
      }
    ]
  }

  chartInstance.setOption(option)
}

const initChart = () => {
  if (!chartRef.value) return
  
  chartInstance = echarts.init(chartRef.value)
  
  fetchStats()

  window.addEventListener('resize', () => {
    chartInstance?.resize()
  })
}

onMounted(() => {
  nextTick(() => {
    initChart()
    refreshInterval = setInterval(fetchStats, 5000)
  })
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
})
</script>

<style scoped>
.chart {
  width: 100%;
  height: 400px;
}
</style>
