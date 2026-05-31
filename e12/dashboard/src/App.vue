<template>
  <div class="app">
    <header class="header">
      <h1>📊 分布式任务队列监控系统</h1>
      <p class="subtitle">实时监控任务执行状态</p>
    </header>
    
    <main class="main">
      <div class="stats-cards">
        <div class="card">
          <div class="card-title">总任务数</div>
          <div class="card-value">{{ totalTasks }}</div>
        </div>
        <div class="card success">
          <div class="card-title">成功任务</div>
          <div class="card-value">{{ successTasks }}</div>
        </div>
        <div class="card failed">
          <div class="card-title">失败任务</div>
          <div class="card-value">{{ failedTasks }}</div>
        </div>
        <div class="card running">
          <div class="card-title">运行中</div>
          <div class="card-value">{{ runningTasks }}</div>
        </div>
      </div>
      
      <div class="chart-container">
        <h2>每分钟成功/失败任务数</h2>
        <TaskChart />
      </div>
      
      <div class="tasks-container">
        <h2>最近任务列表</h2>
        <div class="tasks-table">
          <table>
            <thead>
              <tr>
                <th>任务ID</th>
                <th>任务名称</th>
                <th>状态</th>
                <th>Worker</th>
                <th>执行时间(s)</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in recentTasks" :key="task.id">
                <td>{{ task.task_id.slice(0, 15) }}...</td>
                <td>{{ task.task_name }}</td>
                <td>
                  <span :class="['status-badge', task.status.toLowerCase()]">
                    {{ task.status }}
                  </span>
                </td>
                <td>{{ task.worker_name }}</td>
                <td>{{ task.execution_time.toFixed(2) }}</td>
                <td>{{ formatTime(task.timestamp) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import TaskChart from './components/TaskChart.vue'

const totalTasks = ref(0)
const successTasks = ref(0)
const failedTasks = ref(0)
const runningTasks = ref(0)
const recentTasks = ref([])

let refreshInterval = null

const fetchTasks = async () => {
  try {
    const response = await fetch('/api/v1/tasks?limit=50')
    const data = await response.json()
    recentTasks.value = data
    
    totalTasks.value = data.length
    successTasks.value = data.filter(t => t.status === 'SUCCESS').length
    failedTasks.value = data.filter(t => t.status === 'FAILED').length
    runningTasks.value = data.filter(t => t.status === 'RUNNING').length
  } catch (error) {
    console.error('Failed to fetch tasks:', error)
  }
}

const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

onMounted(() => {
  fetchTasks()
  refreshInterval = setInterval(fetchTasks, 5000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

.app {
  min-height: 100vh;
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
}

.subtitle {
  font-size: 1.1rem;
  opacity: 0.9;
}

.main {
  max-width: 1400px;
  margin: 0 auto;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.card {
  background: white;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  text-align: center;
}

.card-title {
  font-size: 0.95rem;
  color: #666;
  margin-bottom: 10px;
}

.card-value {
  font-size: 2.5rem;
  font-weight: bold;
  color: #333;
}

.card.success .card-value {
  color: #10b981;
}

.card.failed .card-value {
  color: #ef4444;
}

.card.running .card-value {
  color: #3b82f6;
}

.chart-container {
  background: white;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  margin-bottom: 30px;
}

.chart-container h2 {
  margin-bottom: 20px;
  color: #333;
  font-size: 1.3rem;
}

.tasks-container {
  background: white;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.tasks-container h2 {
  margin-bottom: 20px;
  color: #333;
  font-size: 1.3rem;
}

.tasks-table {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 12px 15px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

th {
  background: #f8f9fa;
  font-weight: 600;
  color: #444;
}

tr:hover {
  background: #f8f9fa;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 500;
}

.status-badge.success {
  background: #d1fae5;
  color: #059669;
}

.status-badge.failed {
  background: #fee2e2;
  color: #dc2626;
}

.status-badge.pending {
  background: #fef3c7;
  color: #d97706;
}

.status-badge.running {
  background: #dbeafe;
  color: #2563eb;
}
</style>
