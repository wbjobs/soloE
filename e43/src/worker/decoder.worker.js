import { FFmpegDecoder, parseH265NALUs, parseMP4File } from '../wasm/ffmpeg_wrapper.js';

class DecoderWorker {
  constructor() {
    this.decoder = new FFmpegDecoder();
    this.nalus = [];
    this.currentIndex = 0;
    this.isDecoding = false;
    this.decodedFrames = 0;
    this.lastFpsTime = 0;
    this.fps = 0;
    this.frameQueue = [];
    this.maxQueueSize = 30;
    this.width = 1920;
    this.height = 1080;
    this.pendingReleaseFrames = new Set();
    this.lastMemoryReport = 0;
  }

  async init() {
    try {
      const success = await this.decoder.init();
      if (success) {
        this.postMessage('init', { status: 'success', message: '解码器初始化成功' });
      } else {
        this.postMessage('init', { status: 'error', message: '解码器初始化失败' });
      }
    } catch (e) {
      this.postMessage('init', { status: 'error', message: e.message });
    }
  }

  async loadVideo(fileData, fileName) {
    try {
      this.clearAllFrames();
      
      this.postMessage('load', { status: 'progress', progress: 0, message: '正在解析视频文件...' });

      let nalus;
      if (fileName.endsWith('.mp4')) {
        nalus = parseMP4File(new Uint8Array(fileData));
      } else {
        nalus = parseH265NALUs(new Uint8Array(fileData));
      }

      if (nalus.length === 0) {
        this.postMessage('load', { status: 'error', message: '未找到有效的视频帧' });
        return;
      }

      this.nalus = nalus;
      this.currentIndex = 0;
      this.decodedFrames = 0;

      this.postMessage('load', { status: 'progress', progress: 50, message: '正在打开解码器...' });

      const openSuccess = this.decoder.openDecoder(this.width, this.height);
      if (!openSuccess) {
        this.postMessage('load', { status: 'error', message: '无法打开HEVC解码器' });
        return;
      }

      this.postMessage('load', { 
        status: 'success', 
        message: '视频加载成功',
        totalFrames: nalus.length,
        width: this.width,
        height: this.height
      });

    } catch (e) {
      this.postMessage('load', { status: 'error', message: e.message });
    }
  }

  startDecoding() {
    if (this.isDecoding) return;
    this.isDecoding = true;
    this.lastFpsTime = performance.now();
    this.decodeLoop();
  }

  pauseDecoding() {
    this.isDecoding = false;
  }

  decodeLoop() {
    if (!this.isDecoding) return;

    if (this.frameQueue.length >= this.maxQueueSize) {
      setTimeout(() => this.decodeLoop(), 10);
      return;
    }

    if (this.currentIndex >= this.nalus.length) {
      const remainingFrames = this.decoder.flush();
      remainingFrames.forEach(frame => {
        this.frameQueue.push(frame);
        this.decodedFrames++;
      });
      
      this.postMemoryStats();
      this.postMessage('decode', {
        type: 'complete',
        frame: null,
        fps: this.fps,
        frameCount: this.decodedFrames,
        queueSize: this.frameQueue.length
      });
      this.isDecoding = false;
      return;
    }

    const nalu = this.nalus[this.currentIndex];
    const frame = this.decoder.decode(nalu);

    this.currentIndex++;

    if (frame) {
      this.frameQueue.push(frame);
      this.decodedFrames++;

      const now = performance.now();
      if (now - this.lastFpsTime >= 1000) {
        this.fps = Math.round(this.decodedFrames / ((now - this.lastFpsTime) / 1000));
        this.lastFpsTime = now;
        this.postMemoryStats();
      }

      this.postMessage('decode', {
        type: 'frame',
        frame: frame,
        fps: this.fps,
        frameCount: this.decodedFrames,
        queueSize: this.frameQueue.length,
        progress: Math.round((this.currentIndex / this.nalus.length) * 100)
      });
    }

    setTimeout(() => this.decodeLoop(), 0);
  }

  requestFrame() {
    if (this.frameQueue.length > 0) {
      const frame = this.frameQueue.shift();
      this.postMessage('frame', { frame });
    }
  }

  releaseFrame(frameId) {
    if (!frameId) return;
    const released = this.decoder.releaseFrame(frameId);
    if (released) {
      this.pendingReleaseFrames.delete(frameId);
    }
  }

  releaseFrames(frameIds) {
    frameIds.forEach(id => this.releaseFrame(id));
  }

  seekTo(frameIndex) {
    if (frameIndex < 0 || frameIndex >= this.nalus.length) return;
    
    this.currentIndex = frameIndex;
    this.clearAllFrames();
    this.decodedFrames = frameIndex;
    
    this.postMessage('seek', { 
      status: 'success', 
      currentFrame: frameIndex,
      totalFrames: this.nalus.length
    });
  }

  clearAllFrames() {
    this.frameQueue.forEach(frame => {
      if (frame.frameId) {
        this.decoder.releaseFrame(frame.frameId);
      }
    });
    this.frameQueue = [];
    this.pendingReleaseFrames.clear();
  }

  postMemoryStats() {
    const now = performance.now();
    if (now - this.lastMemoryReport < 2000) return;
    this.lastMemoryReport = now;
    
    const stats = this.decoder.getMemoryStats();
    this.postMessage('memoryStats', {
      ...stats,
      workerQueueSize: this.frameQueue.length
    });
  }

  setResolution(width, height) {
    this.width = width;
    this.height = height;
    if (this.decoder) {
      this.decoder.width = width;
      this.decoder.height = height;
    }
  }

  postMessage(type, data) {
    self.postMessage({ type, ...data });
  }

  handleMessage(e) {
    const { action, ...params } = e.data;
    
    switch (action) {
      case 'init':
        this.init();
        break;
      case 'load':
        this.loadVideo(params.fileData, params.fileName);
        break;
      case 'start':
        this.startDecoding();
        break;
      case 'pause':
        this.pauseDecoding();
        break;
      case 'requestFrame':
        this.requestFrame();
        break;
      case 'releaseFrame':
        this.releaseFrame(params.frameId);
        break;
      case 'releaseFrames':
        this.releaseFrames(params.frameIds);
        break;
      case 'seek':
        this.seekTo(params.frameIndex);
        break;
      case 'setResolution':
        this.setResolution(params.width, params.height);
        break;
      case 'reset':
        this.isDecoding = false;
        this.clearAllFrames();
        this.currentIndex = 0;
        this.decodedFrames = 0;
        break;
      case 'getMemoryStats':
        this.postMemoryStats();
        break;
    }
  }
}

const worker = new DecoderWorker();
self.onmessage = (e) => worker.handleMessage(e);
