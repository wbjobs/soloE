<template>
  <div class="pair-result">
    <div class="stats-panel">
      <h3>📊 统计信息</h3>
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">模型1顶点数</span>
          <span class="stat-value">{{ result.model1.vertexCount.toLocaleString() }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">模型2顶点数</span>
          <span class="stat-value">{{ result.model2.vertexCount.toLocaleString() }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">采样后顶点数</span>
          <span class="stat-value">{{ result.stats.sampledCount1.toLocaleString() }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">最小差异</span>
          <span class="stat-value">{{ formatNumber(result.stats.minDistance) }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">最大差异</span>
          <span class="stat-value">{{ formatNumber(result.stats.maxDistance) }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">平均差异</span>
          <span class="stat-value">{{ formatNumber(result.stats.meanDistance) }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">配准</span>
          <span class="stat-value">{{ result.usedICP ? '✅ 已启用' : '❌ 已禁用' }}</span>
        </div>
        <div class="stat-item" v-if="result.usedICP">
          <span class="stat-label">配准方法</span>
          <span class="stat-value">{{ result.alignMethod === 'simple' ? '平移+缩放' : 'ICP' }}</span>
        </div>
      </div>
    </div>

    <div class="top-diff-panel">
      <h3>📍 差异最大的 5 个顶点</h3>
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
          <tr v-for="(diff, index) in result.topDifferences" :key="index">
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

    <div class="viewer-section">
      <h3>🎯 3D 热力图视图</h3>
      <div class="viewer-container">
        <ModelViewer 
          :file1="file1"
          :file2="file2"
          :heatmap-data="result.heatmap"
          :stats="result.stats"
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
          <span>大差异 ({{ formatNumber(result.stats.maxDistance) }})</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import ModelViewer from './ModelViewer.vue';

const props = defineProps({
  result: Object,
  file1: Object,
  file2: Object
});

const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0.000000';
  if (Math.abs(num) < 0.001 && num !== 0) {
    return num.toExponential(4);
  }
  return num.toFixed(6);
};
</script>

<style scoped>
.pair-result {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.stats-panel,
.top-diff-panel,
.viewer-section {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid #333;
  border-radius: 12px;
  padding: 20px;
}

.stats-panel h3,
.top-diff-panel h3,
.viewer-section h3 {
  margin-bottom: 16px;
  color: #64ffda;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 15px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 8px;
}

.stat-label {
  color: #888;
  font-size: 0.85rem;
}

.stat-value {
  color: #eee;
  font-size: 1.2rem;
  font-weight: 600;
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
