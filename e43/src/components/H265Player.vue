<template>
  <div class="h265-player">
    <div class="player-header">
      <h2>H.265 WebAssembly 视频播放器</h2>
      <div class="performance-stats">
        <span class="stat">解码帧率: {{ decodeFps }} FPS</span>
        <span class="stat">渲染帧率: {{ renderFps }} FPS</span>
        <span class="stat">内存: {{ memoryUsageMB }} MB</span>
        <span class="stat">活跃帧: {{ activeFrames }}</span>
        <span class="stat">池帧: {{ poolFrames }}</span>
      </div>
      
      <div class="decoder-info" @click="showDecoderSelector = !showDecoderSelector">
        <span class="decoder-icon">{{ currentDecoderInfo?.icon || '🔧' }}</span>
        <span class="decoder-name">{{ currentDecoderInfo?.name || '初始化中...' }}</span>
        <span class="decoder-badge" v-if="currentDecoderInfo?.isHardwareAccelerated">
          硬件加速
        </span>
      </div>
      
      <div v-if="showDecoderSelector" class="decoder-selector">
        <div class="selector-title">选择解码器</div>
        <div 
          v-for="decoder in availableDecoders" 
          :key="decoder.type"
          class="decoder-option"
          :class="{ active: decoder.type === currentDecoderType }"
          @click="switchDecoder(decoder.type)"
        >
          <span class="decoder-option-icon">{{ getDecoderIcon(decoder.type) }}</span>
          <span class="decoder-option-name">{{ decoder.name }}</span>
          <span v-if="decoder.preferred" class="preferred-badge">推荐</span>
        </div>
        <div v-if="availableDecoders.length === 0" class="no-decoders">
          正在检测可用解码器...
        </div>
      </div>
    </div>

    <div class="player-container">
      <canvas ref="videoCanvas" class="video-canvas"></canvas>
      
      <div v-if="!videoLoaded" class="upload-overlay">
        <div class="upload-box" @click="triggerFileInput">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p>点击上传 H.265 视频文件</p>
          <p class="small">支持 .mp4 和 .265/.h265 格式</p>
        </div>
        <input ref="fileInput" type="file" accept=".mp4,.265,.h265" @change="handleFileSelect" style="display: none">
      </div>

      <div v-if="loading" class="loading-overlay">
        <div class="spinner"></div>
        <p>{{ loadingMessage }}</p>
        <div class="progress-bar">
          <div class="progress" :style="{ width: loadingProgress + '%' }"></div>
        </div>
      </div>
    </div>

    <div v-if="videoLoaded" class="controls">
      <div class="controls-left">
        <button @click="togglePlay" class="control-btn">
          <svg v-if="isPlaying" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
          <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>
        <button @click="stepFrame(-1)" class="control-btn" title="上一帧">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="19 20 9 12 19 4 19 20"/>
            <line x1="5" y1="19" x2="5" y2="5"/>
          </svg>
        </button>
        <button @click="stepFrame(1)" class="control-btn" title="下一帧">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 4 15 12 5 20 5 4"/>
            <line x1="19" y1="5" x2="19" y2="19"/>
          </svg>
        </button>
      </div>

      <div class="controls-center">
        <span class="time-display">{{ currentFrame }} / {{ totalFrames }}</span>
        <input 
          type="range" 
          class="seek-slider" 
          :min="0" 
          :max="totalFrames - 1" 
          :value="currentFrame"
          @input="handleSeek"
        >
      </div>

      <div class="controls-right">
        <select v-model="selectedResolution" @change="changeResolution" class="resolution-select">
          <option value="1920x1080">1080p</option>
          <option value="1280x720">720p</option>
          <option value="854x480">480p</option>
        </select>
        <button @click="resetPlayer" class="control-btn" title="重置">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
      </div>
    </div>

    <div v-if="errorMessage" class="error-message">
      <span>{{ errorMessage }}</span>
      <button @click="errorMessage = ''">×</button>
    </div>
  </div>
</template>

<script>
import { YUVWebGLRenderer } from '../renderer/yuv_renderer.js';

export default {
  name: 'H265Player',
  data() {
    return {
      decoderWorker: null,
      renderer: null,
      videoLoaded: false,
      isPlaying: false,
      loading: false,
      loadingMessage: '',
      loadingProgress: 0,
      errorMessage: '',
      decodeFps: 0,
      renderFps: 0,
      frameQueueSize: 0,
      currentFrame: 0,
      totalFrames: 0,
      selectedResolution: '1920x1080',
      frameBuffer: [],
      maxBufferSize: 10,
      renderFrameCount: 0,
      lastRenderTime: 0,
      animationId: null,
      releasedFrameIds: [],
      releaseBatchSize: 5,
      memoryUsageMB: 0,
      activeFrames: 0,
      poolFrames: 0,
      currentDecoderInfo: null,
      currentDecoderType: null,
      availableDecoders: [],
      showDecoderSelector: false,
      totalFramesDecoded: 0,
      totalFramesReleased: 0,
      decoderSwitchAttempts: 0
    };
  },
  mounted() {
    this.initPlayer();
  },
  beforeUnmount() {
    this.destroyPlayer();
  },
  methods: {
    initPlayer() {
      try {
        this.renderer = new YUVWebGLRenderer(this.$refs.videoCanvas);
        if (!this.renderer.init()) {
          throw new Error('WebGL 渲染器初始化失败');
        }
        this.renderer.clear();

        this.decoderWorker = new Worker(new URL('../worker/multi_decoder_worker.js', import.meta.url), {
          type: 'module'
        });
        this.decoderWorker.onmessage = this.handleWorkerMessage;
        this.decoderWorker.postMessage({ action: 'init' });

        this.startPerformanceMonitor();
      } catch (e) {
        this.errorMessage = '播放器初始化失败: ' + e.message;
      }
    },

    handleWorkerMessage(e) {
      const { type, ...data } = e.data;
      
      switch (type) {
        case 'init':
          if (data.status === 'success') {
            console.log('解码器初始化成功:', data.decoder);
            this.currentDecoderInfo = data.decoder;
            this.currentDecoderType = data.decoder.type;
            this.decoderWorker.postMessage({ action: 'getAvailableDecoders' });
          } else {
            this.errorMessage = data.message;
          }
          break;

        case 'load':
          if (data.status === 'progress') {
            this.loadingProgress = data.progress;
            this.loadingMessage = data.message;
          } else if (data.status === 'success') {
            this.totalFrames = data.totalFrames;
            this.currentFrame = 0;
            this.videoLoaded = true;
            this.loading = false;
            this.frameBuffer = [];
            if (data.decoder) {
              this.currentDecoderInfo = data.decoder;
              this.currentDecoderType = data.decoder.type;
            }
          } else {
            this.errorMessage = data.message;
            this.loading = false;
          }
          break;

        case 'decode':
          this.decodeFps = data.fps || 0;
          this.frameQueueSize = data.queueSize || 0;
          if (data.frame) {
            this.frameBuffer.push(data.frame);
            if (this.frameBuffer.length > this.maxBufferSize) {
              const droppedFrame = this.frameBuffer.shift();
              this.releaseFrame(droppedFrame);
            }
          }
          if (data.progress !== undefined) {
            this.currentFrame = data.frameCount || 0;
          }
          if (data.decoder) {
            this.currentDecoderInfo = data.decoder;
          }
          break;

        case 'frame':
          if (data.frame) {
            this.frameBuffer.push(data.frame);
          }
          break;

        case 'seek':
          if (data.status === 'success') {
            this.currentFrame = data.currentFrame;
          }
          break;

        case 'memoryStats':
          this.activeFrames = data.activeCount || 0;
          this.poolFrames = data.poolCount || 0;
          this.memoryUsageMB = data.estimatedMemoryMB || 0;
          this.totalFramesDecoded = data.totalDecoded || 0;
          this.totalFramesReleased = data.totalReleased || 0;
          if (data.decoder) {
            this.currentDecoderInfo = data.decoder;
          }
          break;

        case 'decoderChanged':
          this.currentDecoderInfo = data.info;
          this.currentDecoderType = data.type;
          console.log('解码器已切换:', data.info);
          break;

        case 'decoderSwitch':
          if (data.success) {
            this.currentDecoderInfo = data.decoderType;
            this.currentDecoderType = data.decoderType.type;
            console.log('手动切换解码器成功:', data.decoderType);
          }
          break;

        case 'availableDecoders':
          this.availableDecoders = data.decoders || [];
          break;

        case 'decoderError':
          console.error('解码器错误:', data.error, data.decoderType);
          this.errorMessage = `解码器${data.decoderType}出错: ${data.error}`;
          break;
      }
    },

    triggerFileInput() {
      this.$refs.fileInput.click();
    },

    handleFileSelect(e) {
      const file = e.target.files[0];
      if (!file) return;
      this.loadVideoFile(file);
    },

    async loadVideoFile(file) {
      this.loading = true;
      this.loadingMessage = '正在读取文件...';
      this.loadingProgress = 0;
      this.videoLoaded = false;
      this.isPlaying = false;
      this.frameBuffer = [];

      try {
        const arrayBuffer = await file.arrayBuffer();
        this.decoderWorker.postMessage({
          action: 'load',
          fileData: arrayBuffer,
          fileName: file.name
        }, [arrayBuffer]);
      } catch (e) {
        this.errorMessage = '文件读取失败: ' + e.message;
        this.loading = false;
      }

      this.$refs.fileInput.value = '';
    },

    togglePlay() {
      if (!this.videoLoaded) return;

      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    },

    play() {
      this.isPlaying = true;
      this.decoderWorker.postMessage({ action: 'start' });
      this.renderLoop();
    },

    pause() {
      this.isPlaying = false;
      this.decoderWorker.postMessage({ action: 'pause' });
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
      this.flushReleasedFrames();
    },

    stepFrame(direction) {
      if (!this.videoLoaded) return;
      
      const newFrame = Math.max(0, Math.min(this.totalFrames - 1, this.currentFrame + direction));
      this.seekTo(newFrame);
    },

    handleSeek(e) {
      const frameIndex = parseInt(e.target.value);
      this.seekTo(frameIndex);
    },

    seekTo(frameIndex) {
      this.frameBuffer.forEach(frame => this.releaseFrame(frame));
      this.flushReleasedFrames();
      
      this.decoderWorker.postMessage({ 
        action: 'seek', 
        frameIndex: frameIndex 
      });
      this.currentFrame = frameIndex;
      this.frameBuffer = [];
    },

    releaseFrame(frame) {
      if (!frame || !frame.frameId) return;
      this.releasedFrameIds.push(frame.frameId);
      
      if (this.releasedFrameIds.length >= this.releaseBatchSize) {
        this.flushReleasedFrames();
      }
    },

    flushReleasedFrames() {
      if (this.releasedFrameIds.length === 0) return;
      
      this.decoderWorker.postMessage({
        action: 'releaseFrames',
        frameIds: [...this.releasedFrameIds]
      });
      
      this.releasedFrameIds = [];
    },

    renderLoop() {
      if (!this.isPlaying) return;

      if (this.frameBuffer.length > 0) {
        const frame = this.frameBuffer.shift();
        this.renderer.render(frame);
        this.releaseFrame(frame);
        this.renderFrameCount++;
      }

      const now = performance.now();
      if (now - this.lastRenderTime >= 1000) {
        this.renderFps = this.renderFrameCount;
        this.renderFrameCount = 0;
        this.lastRenderTime = now;
        this.flushReleasedFrames();
      }

      this.animationId = requestAnimationFrame(() => this.renderLoop());
    },

    changeResolution() {
      const [width, height] = this.selectedResolution.split('x').map(Number);
      this.decoderWorker.postMessage({
        action: 'setResolution',
        width,
        height
      });
    },

    resetPlayer() {
      this.pause();
      
      this.frameBuffer.forEach(frame => this.releaseFrame(frame));
      this.flushReleasedFrames();
      
      this.decoderWorker.postMessage({ action: 'reset' });
      this.videoLoaded = false;
      this.currentFrame = 0;
      this.totalFrames = 0;
      this.frameBuffer = [];
      this.renderer.clear();
      this.decodeFps = 0;
      this.renderFps = 0;
      this.frameQueueSize = 0;
      this.memoryUsageMB = 0;
      this.activeFrames = 0;
      this.poolFrames = 0;
    },

    switchDecoder(decoderType) {
      this.decoderWorker.postMessage({
        action: 'switchDecoder',
        decoderType
      });
      this.showDecoderSelector = false;
    },

    getDecoderIcon(type) {
      const icons = {
        'webcodecs-hw': '⚡',
        'webcodecs-sw': '💻',
        'wasm': '🔧',
        'none': '❌'
      };
      return icons[type] || '❓';
    },

    startPerformanceMonitor() {
      setInterval(() => {
        if (this.decoderWorker && this.videoLoaded) {
          this.decoderWorker.postMessage({ action: 'getMemoryStats' });
        }
      }, 2000);
    },

    destroyPlayer() {
      this.pause();
      if (this.decoderWorker) {
        this.decoderWorker.terminate();
      }
      if (this.renderer) {
        this.renderer.destroy();
      }
    }
  }
};
</script>

<style scoped>
.h265-player {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  min-height: 100vh;
}

.player-header {
  text-align: center;
  margin-bottom: 20px;
  position: relative;
}

.player-header h2 {
  color: #fff;
  margin-bottom: 15px;
  font-size: 1.8rem;
}

.performance-stats {
  display: flex;
  justify-content: center;
  gap: 15px;
  flex-wrap: wrap;
  margin-bottom: 15px;
}

.stat {
  background: rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  border-radius: 16px;
  color: #00ff88;
  font-family: monospace;
  font-size: 0.85rem;
}

.decoder-info {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(135deg, #4a90e2, #357abd);
  padding: 8px 16px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 2px 10px rgba(74, 144, 226, 0.3);
}

.decoder-info:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(74, 144, 226, 0.4);
}

.decoder-icon {
  font-size: 1.2rem;
}

.decoder-name {
  color: #fff;
  font-weight: 500;
  font-size: 0.9rem;
}

.decoder-badge {
  background: rgba(0, 255, 136, 0.3);
  color: #00ff88;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 600;
}

.decoder-selector {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(30, 30, 50, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 15px;
  min-width: 280px;
  z-index: 1000;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  margin-top: 10px;
}

.selector-title {
  color: #fff;
  font-weight: 600;
  margin-bottom: 12px;
  text-align: left;
  font-size: 0.95rem;
}

.decoder-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 5px;
}

.decoder-option:last-child {
  margin-bottom: 0;
}

.decoder-option:hover {
  background: rgba(74, 144, 226, 0.2);
}

.decoder-option.active {
  background: rgba(74, 144, 226, 0.3);
  border: 1px solid rgba(74, 144, 226, 0.5);
}

.decoder-option-icon {
  font-size: 1.2rem;
}

.decoder-option-name {
  color: #fff;
  font-size: 0.9rem;
  flex: 1;
  text-align: left;
}

.preferred-badge {
  background: linear-gradient(135deg, #00ff88, #00cc6a);
  color: #1a1a2e;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
}

.no-decoders {
  color: #999;
  padding: 10px;
  font-size: 0.9rem;
}

.player-container {
  position: relative;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.video-canvas {
  width: 100%;
  height: auto;
  display: block;
  min-height: 400px;
}

.upload-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
}

.upload-box {
  text-align: center;
  color: #fff;
  cursor: pointer;
  padding: 40px;
  border: 2px dashed #4a90e2;
  border-radius: 12px;
  transition: all 0.3s;
}

.upload-box:hover {
  background: rgba(74, 144, 226, 0.2);
  border-color: #00ff88;
}

.upload-box p {
  margin: 15px 0 5px;
  font-size: 1.1rem;
}

.upload-box .small {
  font-size: 0.85rem;
  opacity: 0.7;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.9);
  color: #fff;
}

.spinner {
  width: 50px;
  height: 50px;
  border: 4px solid rgba(255, 255, 255, 0.2);
  border-top-color: #00ff88;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.progress-bar {
  width: 200px;
  height: 6px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  margin-top: 15px;
  overflow: hidden;
}

.progress {
  height: 100%;
  background: linear-gradient(90deg, #4a90e2, #00ff88);
  transition: width 0.3s;
}

.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  background: rgba(0, 0, 0, 0.5);
  margin-top: 10px;
  border-radius: 12px;
  flex-wrap: wrap;
  gap: 15px;
}

.controls-left,
.controls-right {
  display: flex;
  gap: 10px;
  align-items: center;
}

.control-btn {
  background: linear-gradient(135deg, #4a90e2, #357abd);
  border: none;
  color: #fff;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
}

.control-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(74, 144, 226, 0.4);
}

.controls-center {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 15px;
  min-width: 300px;
}

.time-display {
  color: #fff;
  font-family: monospace;
  font-size: 0.95rem;
  min-width: 100px;
  text-align: center;
}

.seek-slider {
  flex: 1;
  -webkit-appearance: none;
  height: 6px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  outline: none;
}

.seek-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  background: #00ff88;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 255, 136, 0.4);
}

.resolution-select {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.resolution-select option {
  background: #1a1a2e;
  color: #fff;
}

.error-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ff4444;
  color: #fff;
  padding: 12px 20px;
  border-radius: 8px;
  margin-top: 15px;
}

.error-message button {
  background: none;
  border: none;
  color: #fff;
  font-size: 1.5rem;
  cursor: pointer;
  line-height: 1;
}
</style>
