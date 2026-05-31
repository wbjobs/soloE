<template>
  <div class="timeline-result">
    <div class="summary-panel">
      <h3>📊 时序分析摘要</h3>
      <div class="summary-stats">
        <div class="summary-item">
          <span class="summary-label">版本数量</span>
          <span class="summary-value">{{ result.totalVersions }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">基准版本</span>
          <span class="summary-value">V{{ baseVersion + 1 }} - {{ result.versions[baseVersion]?.name }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">配准方法</span>
          <span class="summary-value">{{ result.alignMethod === 'simple' ? '平移+缩放' : 'ICP' }}</span>
        </div>
      </div>
    </div>

    <div class="chart-panel">
      <h3>📈 RMS 差异变化趋势</h3>
      <div class="chart-container">
        <canvas ref="chartCanvas"></canvas>
      </div>
    </div>

    <div class="timeline-panel">
      <div class="timeline-header">
        <h3>⏱️ 时间轴查看器</h3>
        <div class="timeline-controls">
          <button 
            class="control-btn" 
            @click="currentVersion = 0"
            :disabled="isPlaying"
          >
            ⏮️ 开始
          </button>
          <button 
            class="control-btn" 
            @click="prevVersion"
            :disabled="currentVersion === 0 || isPlaying"
          >
            ◀️ 上一个
          </button>
          <button 
            class="control-btn play-btn" 
            @click="togglePlay"
          >
            {{ isPlaying ? '⏸️ 暂停' : '▶️ 播放' }}
          </button>
          <button 
            class="control-btn" 
            @click="nextVersion"
            :disabled="currentVersion === result.totalVersions - 1 || isPlaying"
          >
            下一个 ▶️
          </button>
          <button 
            class="control-btn" 
            @click="currentVersion = result.totalVersions - 1"
            :disabled="isPlaying"
          >
            结束 ⏭️
          </button>
        </div>
      </div>

      <div class="timeline-slider-section">
        <div class="slider-labels">
          <span v-for="(v, i) in result.versions" :key="i" class="slider-label"
                :class="{ active: currentVersion === i, base: i === baseVersion }">
            V{{ i + 1 }}
            <span v-if="i === baseVersion" class="base-tag">基准</span>
          </span>
        </div>
        <input 
          type="range" 
          :min="0" 
          :max="result.totalVersions - 1" 
          v-model.number="currentVersion"
          :disabled="isPlaying"
          class="timeline-slider"
        />
        <div class="slider-values">
          <span v-for="(v, i) in result.versions" :key="i" class="slider-value"
                :class="{ active: currentVersion === i }">
            {{ formatNumber(getRMS(i)) }}
          </span>
        </div>
      </div>

      <div class="version-info">
        <div class="version-card" :class="{ base: currentVersion === baseVersion }">
          <span class="version-badge">V{{ currentVersion + 1 }}</span>
          <span class="version-name">{{ result.versions[currentVersion]?.name }}</span>
          <span v-if="currentVersion === baseVersion" class="base-indicator">基准版本</span>
        </div>
        <div class="version-stats">
          <div class="mini-stat">
            <span class="mini-label">顶点数</span>
            <span class="mini-value">{{ result.versions[currentVersion]?.vertexCount.toLocaleString() }}</span>
          </div>
          <div class="mini-stat">
            <span class="mini-label">RMS 差异</span>
            <span class="mini-value highlight">{{ formatNumber(getRMS(currentVersion)) }}</span>
          </div>
          <div class="mini-stat">
            <span class="mini-label">最大差异</span>
            <span class="mini-value">{{ formatNumber(currentTimeline?.stats?.maxDistance) }}</span>
          </div>
          <div class="mini-stat">
            <span class="mini-label">平均差异</span>
            <span class="mini-value">{{ formatNumber(currentTimeline?.stats?.meanDistance) }}</span>
          </div>
        </div>
      </div>

      <div v-if="currentTimeline && currentTimeline.topDifferences && currentTimeline.topDifferences.length > 0" class="top-diff-panel">
        <h4>📍 当前版本差异最大的 5 个顶点</h4>
        <table class="diff-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>顶点索引</th>
              <th>X</th>
              <th>Y</th>
              <th>Z</th>
              <th>差异值</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(diff, index) in currentTimeline.topDifferences" :key="index">
              <td class="rank">{{ index + 1 }}</td>
              <td>{{ diff.index }}</td>
              <td>{{ formatNumber(diff.vertex[0]) }}</td>
              <td>{{ formatNumber(diff.vertex[1]) }}</td>
              <td>{{ formatNumber(diff.vertex[2]) }}</td>
              <td class="distance">{{ formatNumber(diff.distance) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="currentVersion === baseVersion" class="base-version-notice">
        📍 当前为基准版本，与自身无差异
      </div>
    </div>

    <div class="viewer-section">
      <h3>🎯 3D 热力图视图</h3>
      <div class="viewer-container">
        <ModelViewer 
          :key="viewerKey"
          :file1="baseFile"
          :file2="currentFile"
          :heatmap-data="currentHeatmap"
          :stats="currentTimeline?.stats || { maxDistance: 0 }"
        />
      </div>
      <div class="legend">
        <div class="legend-item">
          <div class="legend-color" style="background: #00ff00"></div>
          <span>小差异 (0)</span>
        </div>
        <div class="legend-bar"></div>
        <div class="legend-item">
          <div class="legend-color" style="background: #ff0000"></div>
          <span>大差异 ({{ formatNumber(maxDistance) }})</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { Chart, registerables } from 'chart.js';
import ModelViewer from './ModelViewer.vue';

Chart.register(...registerables);

const props = defineProps({
  result: Object,
  files: Array,
  baseVersion: Number
});

const currentVersion = ref(0);
const isPlaying = ref(false);
const chartCanvas = ref(null);
const viewerKey = ref(0);

let chartInstance = null;
let playInterval = null;

const baseFile = computed(() => props.files[props.baseVersion]);
const currentFile = computed(() => props.files[currentVersion.value]);

const currentTimeline = computed(() => {
  if (!props.result?.timeline) return null;
  return props.result.timeline[currentVersion.value];
});

const currentHeatmap = computed(() => {
  return currentTimeline.value?.heatmap || { colors: [] };
});

const maxDistance = computed(() => {
  if (!props.result?.timeline) return 0;
  const maxes = props.result.timeline.map(t => t.stats?.maxDistance || 0);
  return Math.max(...maxes);
});

const getRMS = (index) => {
  if (!props.result?.rmsTrend) return 0;
  return props.result.rmsTrend[index]?.rms || 0;
};

const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0.000000';
  if (Math.abs(num) < 0.001 && num !== 0) {
    return num.toExponential(4);
  }
  return num.toFixed(6);
};

const prevVersion = () => {
  if (currentVersion.value > 0) {
    currentVersion.value--;
  }
};

const nextVersion = () => {
  if (currentVersion.value < props.result.totalVersions - 1) {
    currentVersion.value++;
  }
};

const togglePlay = () => {
  if (isPlaying.value) {
    stopPlay();
  } else {
    startPlay();
  }
};

const startPlay = () => {
  if (currentVersion.value >= props.result.totalVersions - 1) {
    currentVersion.value = 0;
  }
  isPlaying.value = true;
  playInterval = setInterval(() => {
    if (currentVersion.value < props.result.totalVersions - 1) {
      currentVersion.value++;
    } else {
      stopPlay();
    }
  }, 1500);
};

const stopPlay = () => {
  isPlaying.value = false;
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
  }
};

const initChart = () => {
  if (!chartCanvas.value || !props.result?.rmsTrend) return;

  if (chartInstance) {
    chartInstance.destroy();
  }

  const labels = props.result.rmsTrend.map((item, i) => `V${i + 1}`);
  const data = props.result.rmsTrend.map(item => item.rms);

  const ctx = chartCanvas.value.getContext('2d');
  
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'RMS 差异',
        data: data,
        borderColor: '#64ffda',
        backgroundColor: 'rgba(100, 255, 218, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointRadius: 6,
        pointBackgroundColor: '#64ffda',
        pointBorderColor: '#1a1a2e',
        pointBorderWidth: 2,
        pointHoverRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(26, 26, 46, 0.95)',
          titleColor: '#64ffda',
          bodyColor: '#eee',
          borderColor: '#64ffda',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              const name = props.result.versions[idx]?.name || '';
              return `V${idx + 1} - ${name}`;
            },
            label: (item) => {
              return `RMS 差异: ${formatNumber(item.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#aaa',
            font: {
              size: 12,
              weight: 'bold'
            }
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#aaa',
            callback: function(value) {
              return value.toExponential(2);
            }
          },
          title: {
            display: true,
            text: 'RMS 差异',
            color: '#888'
          }
        }
      },
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          currentVersion.value = index;
        }
      }
    }
  });
};

const updateChartHighlight = () => {
  if (!chartInstance) return;
  
  chartInstance.data.datasets[0].pointBackgroundColor = props.result.rmsTrend.map((_, i) => {
    return i === currentVersion.value ? '#ff6b6b' : '#64ffda';
  });
  chartInstance.data.datasets[0].pointRadius = props.result.rmsTrend.map((_, i) => {
    return i === currentVersion.value ? 10 : 6;
  });
  chartInstance.update('none');
};

watch(() => currentVersion.value, () => {
  updateChartHighlight();
  viewerKey.value++;
});

watch(() => props.result, () => {
  nextTick(() => {
    initChart();
  });
}, { immediate: true, deep: true });

onMounted(() => {
  nextTick(() => {
    initChart();
  });
});

onUnmounted(() => {
  stopPlay();
  if (chartInstance) {
    chartInstance.destroy();
  }
});
</script>

<style scoped>
.timeline-result {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.summary-panel,
.chart-panel,
.timeline-panel,
.viewer-section {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid #333;
  border-radius: 12px;
  padding: 20px;
}

.summary-panel h3,
.chart-panel h3,
.timeline-panel h3,
.timeline-panel h4,
.viewer-section h3 {
  margin-bottom: 16px;
  color: #64ffda;
}

.summary-stats {
  display: flex;
  gap: 30px;
  flex-wrap: wrap;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-label {
  color: #888;
  font-size: 0.9rem;
}

.summary-value {
  color: #eee;
  font-size: 1.3rem;
  font-weight: 600;
}

.chart-container {
  width: 100%;
  height: 250px;
  position: relative;
}

.timeline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 15px;
  margin-bottom: 20px;
}

.timeline-controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.control-btn {
  padding: 8px 16px;
  background: #2a2a4a;
  border: 1px solid #444;
  border-radius: 6px;
  color: #aaa;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.9rem;
}

.control-btn:hover:not(:disabled) {
  border-color: #64ffda;
  color: #64ffda;
}

.control-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.control-btn.play-btn {
  background: linear-gradient(135deg, #64ffda, #4fd1c5);
  color: #1a1a2e;
  font-weight: 600;
  border-color: #64ffda;
}

.control-btn.play-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(100, 255, 218, 0.3);
}

.timeline-slider-section {
  margin-bottom: 20px;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 5px;
}

.slider-label {
  color: #666;
  font-size: 0.85rem;
  font-weight: 500;
  position: relative;
  cursor: pointer;
  transition: all 0.2s ease;
}

.slider-label:hover {
  color: #64ffda;
}

.slider-label.active {
  color: #64ffda;
  font-weight: 700;
  transform: scale(1.1);
}

.slider-label.base {
  color: #ffb74d;
}

.slider-label.base.active {
  color: #ffb74d;
}

.base-tag {
  display: block;
  font-size: 0.7rem;
  color: #ffb74d;
  text-align: center;
}

.timeline-slider {
  width: 100%;
  height: 8px;
  -webkit-appearance: none;
  appearance: none;
  background: linear-gradient(to right, #64ffda, #64ffda) no-repeat, #2a2a4a;
  background-size: var(--progress, 0%) 100%;
  border-radius: 4px;
  outline: none;
  cursor: pointer;
}

.timeline-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #64ffda;
  cursor: pointer;
  border: 3px solid #1a1a2e;
  box-shadow: 0 2px 8px rgba(100, 255, 218, 0.5);
  transition: all 0.2s ease;
}

.timeline-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.timeline-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #64ffda;
  cursor: pointer;
  border: 3px solid #1a1a2e;
  box-shadow: 0 2px 8px rgba(100, 255, 218, 0.5);
}

.slider-values {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  padding: 0 5px;
}

.slider-value {
  color: #666;
  font-size: 0.75rem;
  font-family: monospace;
}

.slider-value.active {
  color: #64ffda;
  font-weight: 600;
}

.version-info {
  display: flex;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap;
  padding: 15px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  margin-bottom: 15px;
}

.version-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(100, 255, 218, 0.1);
  border-radius: 8px;
  border: 1px solid rgba(100, 255, 218, 0.3);
}

.version-card.base {
  background: rgba(255, 183, 77, 0.1);
  border-color: rgba(255, 183, 77, 0.3);
}

.version-badge {
  background: linear-gradient(135deg, #64ffda, #4fd1c5);
  color: #1a1a2e;
  padding: 4px 12px;
  border-radius: 4px;
  font-weight: 700;
}

.version-card.base .version-badge {
  background: linear-gradient(135deg, #ffb74d, #ffa726);
}

.version-name {
  color: #eee;
  font-weight: 500;
}

.base-indicator {
  color: #ffb74d;
  font-size: 0.85rem;
  font-weight: 600;
}

.version-stats {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  flex: 1;
  justify-content: flex-end;
}

.mini-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: right;
}

.mini-label {
  color: #888;
  font-size: 0.8rem;
}

.mini-value {
  color: #eee;
  font-weight: 600;
  font-family: monospace;
}

.mini-value.highlight {
  color: #64ffda;
  font-size: 1.1rem;
}

.base-version-notice {
  text-align: center;
  padding: 20px;
  color: #888;
  background: rgba(255, 183, 77, 0.05);
  border-radius: 8px;
  border: 1px dashed rgba(255, 183, 77, 0.3);
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
}

.diff-table th,
.diff-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #333;
}

.diff-table th {
  background: rgba(100, 255, 218, 0.1);
  color: #64ffda;
  font-weight: 500;
}

.diff-table tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.diff-table .rank {
  color: #ffb74d;
  font-weight: 600;
}

.diff-table .distance {
  color: #ff6b6b;
  font-weight: 600;
}

.viewer-container {
  width: 100%;
  height: 500px;
  background: #0a0a1a;
  border-radius: 8px;
  overflow: hidden;
}

.legend {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  margin-top: 15px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #aaa;
  font-size: 0.9rem;
}

.legend-color {
  width: 20px;
  height: 20px;
  border-radius: 4px;
}

.legend-bar {
  width: 300px;
  height: 20px;
  border-radius: 4px;
  background: linear-gradient(to right, #00ff00, #ffff00, #ff0000);
}
</style>
