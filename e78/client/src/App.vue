<template>
  <div class="app">
    <header class="header">
      <h1>3D 模型差异比较工具</h1>
      <p class="subtitle">基于 ICP 配准的顶点差异分析与热力图可视化</p>
    </header>

    <main class="main">
      <div class="mode-tabs">
        <button 
          class="tab-btn" 
          :class="{ active: mode === 'pair' }"
          @click="mode = 'pair'"
        >
          🔄 双模型比较
        </button>
        <button 
          class="tab-btn" 
          :class="{ active: mode === 'timeline' }"
          @click="mode = 'timeline'"
        >
          📅 时间轴动画
        </button>
      </div>

      <div v-if="mode === 'pair'">
        <div class="upload-section">
          <div class="upload-panel">
            <h3>模型 1 (基准)</h3>
            <div 
              class="drop-zone" 
              :class="{ 'has-file': file1, 'dragover': dragOver1 }"
              @dragover.prevent="dragOver1 = true"
              @dragleave="dragOver1 = false"
              @drop.prevent="handleDrop($event, 1)"
              @click="triggerFileInput(1)"
            >
              <input 
                ref="fileInput1" 
                type="file" 
                accept=".obj,.gltf,.glb" 
                @change="handleFileChange($event, 1)"
                style="display: none"
              />
              <div v-if="file1" class="file-info">
                <span class="file-icon">📄</span>
                <span class="file-name">{{ file1.name }}</span>
                <span class="file-size">{{ formatFileSize(file1.size) }}</span>
              </div>
              <div v-else class="upload-placeholder">
                <span class="upload-icon">⬆️</span>
                <span>点击或拖拽上传 OBJ/GLTF/GLB</span>
              </div>
            </div>
          </div>

          <div class="compare-icon">⚡</div>

          <div class="upload-panel">
            <h3>模型 2 (比较)</h3>
            <div 
              class="drop-zone" 
              :class="{ 'has-file': file2, 'dragover': dragOver2 }"
              @dragover.prevent="dragOver2 = true"
              @dragleave="dragOver2 = false"
              @drop.prevent="handleDrop($event, 2)"
              @click="triggerFileInput(2)"
            >
              <input 
                ref="fileInput2" 
                type="file" 
                accept=".obj,.gltf,.glb" 
                @change="handleFileChange($event, 2)"
                style="display: none"
              />
              <div v-if="file2" class="file-info">
                <span class="file-icon">📄</span>
                <span class="file-name">{{ file2.name }}</span>
                <span class="file-size">{{ formatFileSize(file2.size) }}</span>
              </div>
              <div v-else class="upload-placeholder">
                <span class="upload-icon">⬆️</span>
                <span>点击或拖拽上传 OBJ/GLTF/GLB</span>
              </div>
            </div>
          </div>
        </div>

        <div class="options-section">
          <label class="option-item">
            <input type="checkbox" v-model="useICP" />
            <span>启用配准</span>
          </label>
          <label class="option-item" v-if="useICP">
            <span>配准方法:</span>
            <select v-model="alignMethod">
              <option value="icp">ICP (平移+旋转)</option>
              <option value="simple">简单 (平移+缩放)</option>
            </select>
          </label>
          <label class="option-item">
            <span>采样顶点数:</span>
            <select v-model="sampleCount">
              <option :value="1000">1,000</option>
              <option :value="5000">5,000</option>
              <option :value="10000" selected>10,000</option>
              <option :value="20000">20,000</option>
              <option :value="50000">50,000</option>
            </select>
          </label>
        </div>

        <button 
          class="compare-btn" 
          :disabled="!file1 || !file2 || loading"
          @click="compareModels"
        >
          <span v-if="loading">⏳ {{ progressMessage || '计算中...' }}</span>
          <span v-else>🔍 开始比较</span>
        </button>
      </div>

      <div v-else>
        <div class="timeline-upload-section">
          <h3>📁 上传模型版本（按时间顺序）</h3>
          <div 
            class="timeline-drop-zone"
            :class="{ 'dragover': timelineDragOver }"
            @dragover.prevent="timelineDragOver = true"
            @dragleave="timelineDragOver = false"
            @drop.prevent="handleTimelineDrop"
            @click="triggerTimelineFileInput"
          >
            <input 
              ref="timelineFileInput" 
              type="file" 
              accept=".obj,.gltf,.glb" 
              multiple
              @change="handleTimelineFileChange"
              style="display: none"
            />
            <div class="timeline-upload-placeholder">
              <span class="upload-icon">📂</span>
              <span>点击或拖拽上传多个模型版本 (V1, V2, V3...)</span>
              <span class="hint">支持多选，按上传顺序排列</span>
            </div>
          </div>

          <div v-if="timelineFiles.length > 0" class="timeline-file-list">
            <div 
              v-for="(file, index) in timelineFiles" 
              :key="index"
              class="timeline-file-item"
            >
              <span class="version-badge">V{{ index + 1 }}</span>
              <span class="file-name">{{ file.name }}</span>
              <span class="file-size">{{ formatFileSize(file.size) }}</span>
              <button class="remove-btn" @click="removeTimelineFile(index)">✕</button>
            </div>
          </div>
        </div>

        <div class="options-section">
          <label class="option-item">
            <span>基准版本:</span>
            <select v-model="timelineBaseVersion" :disabled="timelineFiles.length === 0">
              <option v-for="(f, i) in timelineFiles" :key="i" :value="i">
                V{{ i + 1 }} - {{ f.name }}
              </option>
            </select>
          </label>
          <label class="option-item">
            <input type="checkbox" v-model="useICP" />
            <span>启用配准</span>
          </label>
          <label class="option-item" v-if="useICP">
            <span>配准方法:</span>
            <select v-model="alignMethod">
              <option value="simple">简单 (平移+缩放)</option>
              <option value="icp">ICP (平移+旋转)</option>
            </select>
          </label>
          <label class="option-item">
            <span>采样顶点数:</span>
            <select v-model="sampleCount">
              <option :value="1000">1,000</option>
              <option :value="5000">5,000</option>
              <option :value="10000" selected>10,000</option>
              <option :value="20000">20,000</option>
            </select>
          </label>
        </div>

        <button 
          class="compare-btn" 
          :disabled="timelineFiles.length < 2 || timelineLoading"
          @click="compareTimeline"
        >
          <span v-if="timelineLoading">⏳ {{ progressMessage || '计算中...' }}</span>
          <span v-else>📊 开始时序分析</span>
        </button>
      </div>

      <div v-if="(mode === 'pair' && loading) || (mode === 'timeline' && timelineLoading)" class="progress-section">
        <div class="progress-bar-container">
          <div class="progress-bar-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <div class="progress-text">
          {{ progressMessage }} ({{ progressPercent }}%)
        </div>
      </div>

      <div v-if="error" class="error-message">
        ❌ {{ error }}
      </div>

      <div v-if="mode === 'pair' && pairResult" class="result-section">
        <PairResultViewer 
          :result="pairResult"
          :file1="file1"
          :file2="file2"
        />
      </div>

      <div v-if="mode === 'timeline' && timelineResult" class="result-section">
        <TimelineResultViewer 
          :result="timelineResult"
          :files="timelineFiles"
          :base-version="timelineBaseVersion"
        />
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import axios from 'axios';
import PairResultViewer from './components/PairResultViewer.vue';
import TimelineResultViewer from './components/TimelineResultViewer.vue';

const mode = ref('pair');

const file1 = ref(null);
const file2 = ref(null);
const dragOver1 = ref(false);
const dragOver2 = ref(false);

const timelineFiles = ref([]);
const timelineDragOver = ref(false);
const timelineBaseVersion = ref(0);

const useICP = ref(true);
const alignMethod = ref('simple');
const sampleCount = ref(10000);

const loading = ref(false);
const timelineLoading = ref(false);
const error = ref('');
const pairResult = ref(null);
const timelineResult = ref(null);

const progressPercent = ref(-1);
const progressMessage = ref('');

const fileInput1 = ref(null);
const fileInput2 = ref(null);
const timelineFileInput = ref(null);

let ws = null;
let wsReconnectAttempts = 0;
const maxReconnectAttempts = 3;

function connectWebSocket() {
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket 已连接');
      wsReconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'progress') {
          progressPercent.value = data.percent;
          progressMessage.value = data.message;
        } else if (data.type === 'error') {
          console.error('WebSocket 错误:', data.error);
        } else if (data.type === 'complete') {
          progressPercent.value = 100;
          progressMessage.value = '完成！';
        }
      } catch (e) {
        console.error('解析 WebSocket 消息失败:', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket 已断开');
      if ((loading.value || timelineLoading.value) && wsReconnectAttempts < maxReconnectAttempts) {
        wsReconnectAttempts++;
        console.log(`尝试重连 WebSocket (${wsReconnectAttempts}/${maxReconnectAttempts})...`);
        setTimeout(connectWebSocket, 1000);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket 错误:', error);
    };
  } catch (e) {
    console.error('创建 WebSocket 失败:', e);
  }
}

function disconnectWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
}

const triggerFileInput = (num) => {
  if (num === 1) {
    fileInput1.value?.click();
  } else {
    fileInput2.value?.click();
  }
};

const handleFileChange = (event, num) => {
  const file = event.target.files[0];
  if (file) {
    if (num === 1) {
      file1.value = file;
    } else {
      file2.value = file;
    }
    error.value = '';
    pairResult.value = null;
  }
};

const handleDrop = (event, num) => {
  const file = event.dataTransfer.files[0];
  if (file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (['.obj', '.gltf', '.glb'].includes(ext)) {
      if (num === 1) {
        file1.value = file;
        dragOver1.value = false;
      } else {
        file2.value = file;
        dragOver2.value = false;
      }
      error.value = '';
      pairResult.value = null;
    } else {
      error.value = '仅支持 OBJ, GLTF, GLB 格式文件';
    }
  }
};

const triggerTimelineFileInput = () => {
  timelineFileInput.value?.click();
};

const handleTimelineFileChange = (event) => {
  const files = Array.from(event.target.files);
  for (const file of files) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!['.obj', '.gltf', '.glb'].includes(ext)) {
      error.value = `文件 ${file.name} 格式不支持`;
      return;
    }
  }
  timelineFiles.value = [...timelineFiles.value, ...files];
  error.value = '';
  timelineResult.value = null;
};

const handleTimelineDrop = (event) => {
  timelineDragOver.value = false;
  const files = Array.from(event.dataTransfer.files);
  for (const file of files) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!['.obj', '.gltf', '.glb'].includes(ext)) {
      error.value = `文件 ${file.name} 格式不支持`;
      return;
    }
  }
  timelineFiles.value = [...timelineFiles.value, ...files];
  error.value = '';
  timelineResult.value = null;
};

const removeTimelineFile = (index) => {
  timelineFiles.value.splice(index, 1);
  if (timelineBaseVersion.value >= timelineFiles.value.length) {
    timelineBaseVersion.value = Math.max(0, timelineFiles.value.length - 1);
  }
  timelineResult.value = null;
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const compareModels = async () => {
  if (!file1.value || !file2.value) {
    error.value = '请先上传两个模型文件';
    return;
  }

  loading.value = true;
  error.value = '';
  pairResult.value = null;
  progressPercent.value = 0;
  progressMessage.value = '准备中...';

  connectWebSocket();

  try {
    const formData = new FormData();
    formData.append('model1', file1.value);
    formData.append('model2', file2.value);
    formData.append('useICP', useICP.value);
    formData.append('sampleCount', sampleCount.value);
    formData.append('alignMethod', alignMethod.value);

    const response = await axios.post('/api/compare', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      timeout: 600000
    });

    pairResult.value = response.data;
    progressPercent.value = 100;
    progressMessage.value = '完成！';
  } catch (err) {
    console.error('比较失败:', err);
    error.value = err.response?.data?.error || err.message || '比较失败，请重试';
  } finally {
    loading.value = false;
    setTimeout(() => {
      progressPercent.value = -1;
      progressMessage.value = '';
      disconnectWebSocket();
    }, 2000);
  }
};

const compareTimeline = async () => {
  if (timelineFiles.value.length < 2) {
    error.value = '请至少上传2个模型版本';
    return;
  }

  timelineLoading.value = true;
  error.value = '';
  timelineResult.value = null;
  progressPercent.value = 0;
  progressMessage.value = '准备中...';

  connectWebSocket();

  try {
    const formData = new FormData();
    for (const file of timelineFiles.value) {
      formData.append('models', file);
    }
    formData.append('useICP', useICP.value);
    formData.append('sampleCount', sampleCount.value);
    formData.append('alignMethod', alignMethod.value);
    formData.append('baseVersion', timelineBaseVersion.value);

    const response = await axios.post('/api/compare-timeline', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      },
      timeout: 600000
    });

    timelineResult.value = response.data;
    progressPercent.value = 100;
    progressMessage.value = '完成！';
  } catch (err) {
    console.error('时序比较失败:', err);
    error.value = err.response?.data?.error || err.message || '比较失败，请重试';
  } finally {
    timelineLoading.value = false;
    setTimeout(() => {
      progressPercent.value = -1;
      progressMessage.value = '';
      disconnectWebSocket();
    }, 2000);
  }
};

onMounted(() => {
});

onUnmounted(() => {
  disconnectWebSocket();
});
</script>

<style scoped>
.app {
  min-height: 100vh;
  padding: 20px;
}

.header {
  text-align: center;
  margin-bottom: 20px;
}

.header h1 {
  font-size: 2rem;
  color: #64ffda;
  margin-bottom: 8px;
}

.subtitle {
  color: #888;
  font-size: 0.95rem;
}

.main {
  max-width: 1400px;
  margin: 0 auto;
}

.mode-tabs {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 20px;
}

.tab-btn {
  padding: 10px 24px;
  font-size: 1rem;
  background: #2a2a4a;
  border: 2px solid #444;
  border-radius: 8px;
  color: #aaa;
  cursor: pointer;
  transition: all 0.3s ease;
}

.tab-btn:hover {
  border-color: #64ffda;
  color: #64ffda;
}

.tab-btn.active {
  background: linear-gradient(135deg, #64ffda, #4fd1c5);
  border-color: #64ffda;
  color: #1a1a2e;
  font-weight: 600;
}

.upload-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.upload-panel {
  flex: 1;
  min-width: 300px;
  max-width: 400px;
}

.upload-panel h3 {
  margin-bottom: 10px;
  color: #aaa;
  font-weight: 500;
}

.drop-zone {
  border: 2px dashed #444;
  border-radius: 12px;
  padding: 30px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: rgba(255, 255, 255, 0.02);
}

.drop-zone:hover,
.drop-zone.dragover {
  border-color: #64ffda;
  background: rgba(100, 255, 218, 0.05);
}

.drop-zone.has-file {
  border-style: solid;
  border-color: #4caf50;
  background: rgba(76, 175, 80, 0.1);
}

.upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: #888;
}

.upload-icon {
  font-size: 2rem;
}

.file-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.file-icon {
  font-size: 1.5rem;
}

.file-name {
  color: #eee;
  font-weight: 500;
  word-break: break-all;
}

.file-size {
  color: #888;
  font-size: 0.85rem;
}

.compare-icon {
  font-size: 2rem;
  color: #64ffda;
}

.timeline-upload-section {
  margin-bottom: 20px;
}

.timeline-upload-section h3 {
  color: #aaa;
  font-weight: 500;
  margin-bottom: 10px;
  text-align: center;
}

.timeline-drop-zone {
  border: 2px dashed #444;
  border-radius: 12px;
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: rgba(255, 255, 255, 0.02);
}

.timeline-drop-zone:hover,
.timeline-drop-zone.dragover {
  border-color: #64ffda;
  background: rgba(100, 255, 218, 0.05);
}

.timeline-upload-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: #888;
}

.timeline-upload-placeholder .hint {
  font-size: 0.85rem;
  color: #666;
}

.timeline-file-list {
  margin-top: 15px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.timeline-file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid #333;
  border-radius: 8px;
}

.version-badge {
  background: linear-gradient(135deg, #64ffda, #4fd1c5);
  color: #1a1a2e;
  padding: 4px 10px;
  border-radius: 4px;
  font-weight: 700;
  font-size: 0.85rem;
}

.timeline-file-item .file-name {
  flex: 1;
  color: #eee;
}

.remove-btn {
  background: #ff4444;
  color: white;
  border: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  transition: all 0.2s ease;
}

.remove-btn:hover {
  background: #ff6666;
  transform: scale(1.1);
}

.options-section {
  display: flex;
  justify-content: center;
  gap: 30px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #aaa;
}

.option-item input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.option-item select {
  padding: 6px 12px;
  background: #2a2a4a;
  border: 1px solid #444;
  border-radius: 6px;
  color: #eee;
  cursor: pointer;
}

.compare-btn {
  display: block;
  margin: 0 auto 20px;
  padding: 14px 48px;
  font-size: 1.1rem;
  font-weight: 600;
  color: #1a1a2e;
  background: linear-gradient(135deg, #64ffda, #4fd1c5);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.compare-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(100, 255, 218, 0.3);
}

.compare-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.progress-section {
  max-width: 600px;
  margin: 0 auto 20px;
}

.progress-bar-container {
  width: 100%;
  height: 10px;
  background: #2a2a4a;
  border-radius: 5px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #64ffda, #4fd1c5);
  border-radius: 5px;
  transition: width 0.3s ease;
}

.progress-text {
  text-align: center;
  color: #64ffda;
  font-size: 0.9rem;
}

.error-message {
  background: rgba(255, 68, 68, 0.1);
  border: 1px solid #ff4444;
  color: #ff6666;
  padding: 12px 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  text-align: center;
}

.result-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
</style>
