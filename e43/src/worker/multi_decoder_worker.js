import { DecoderManager } from '../decoder/decoder_manager.js';
import { parseH265NALUs, parseMP4File } from '../wasm/ffmpeg_wrapper.js';

class MultiDecoderWorker {
  constructor() {
    this.decoderManager = null;
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
    this.pendingReleaseFrames = [];
    this.currentDecoderType = null;
    this.initialized = false;
  }

  async init() {
    try {
      this.decoderManager = new DecoderManager({
        width: this.width,
        height: this.height,
        maxQueueSize: this.maxQueueSize,
        onFrame: (frame) => this.handleFrame(frame),
        onError: (error, decoderType) => this.handleError(error, decoderType),
        onDecoderChange: (type, info) => this.handleDecoderChange(type, info)
      });

      const success = await this.decoderManager.init();
      
      if (success) {
        this.initialized = true;
        const decoderInfo = this.decoderManager.getDecoderInfo();
        this.currentDecoderType = decoderInfo.type;
        this.postMessage('init', { 
          status: 'success', 
          message: '解码器初始化成功',
          decoder: decoderInfo
        });
      } else {
        this.postMessage('init', { status: 'error', message: '所有解码器初始化失败' });
      }
    } catch (e) {
      console.error('初始化失败:', e);
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

      this.postMessage('load', { 
        status: 'success', 
        message: '视频加载成功',
        totalFrames: nalus.length,
        width: this.width,
        height: this.height,
        decoder: this.decoderManager.getDecoderInfo()
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
      this.flushDecoder();
      this.isDecoding = false;
      return;
    }

    const nalu = this.nalus[this.currentIndex];
    const result = this.decoderManager.decode(nalu);

    this.currentIndex++;

    if (result) {
      this.decodedFrames++;

      const now = performance.now();
      if (now - this.lastFpsTime >= 1000) {
        this.fps = Math.round(this.decodedFrames / ((now - this.lastFpsTime) / 1000));
        this.lastFpsTime = now;
        this.postMemoryStats();
      }
    }

    setTimeout(() => this.decodeLoop(), 0);
  }

  handleFrame(frame) {
    if (this.frameQueue.length >= this.maxQueueSize) {
      const dropped = this.frameQueue.shift();
      this.releaseFrame(dropped.frameId);
    }
    this.frameQueue.push(frame);

    this.postMessage('decode', {
      type: 'frame',
      frame: this.prepareFrameForMessage(frame),
      fps: this.fps,
      frameCount: this.decodedFrames,
      queueSize: this.frameQueue.length,
      progress: Math.round((this.currentIndex / this.nalus.length) * 100),
      decoder: this.decoderManager.getDecoderInfo()
    });
  }

  prepareFrameForMessage(frame) {
    return {
      frameId: frame.frameId,
      width: frame.width,
      height: frame.height,
      pts: frame.pts,
      format: frame.format,
      timestamp: frame.timestamp,
      duration: frame.duration,
      hasVideoFrame: !!frame.videoFrame
    };
  }

  handleError(error, decoderType) {
    this.postMessage('decoderError', {
      error: error.message,
      decoderType
    });
  }

  handleDecoderChange(type, info) {
    this.currentDecoderType = type;
    this.postMessage('decoderChanged', {
      type,
      info
    });
  }

  requestFrame() {
    if (this.frameQueue.length > 0) {
      const frame = this.frameQueue.shift();
      this.postMessage('frame', { 
        frame: this.prepareFrameForMessage(frame)
      });
      return frame;
    }
    return null;
  }

  releaseFrame(frameId) {
    if (!frameId) return;
    this.decoderManager.releaseFrame({ frameId });
  }

  releaseFrames(frameIds) {
    this.decoderManager.releaseFrames(frameIds);
  }

  async flushDecoder() {
    const frames = await this.decoderManager.flush();
    frames.forEach(frame => {
      this.frameQueue.push(frame);
      this.decodedFrames++;
    });

    this.postMemoryStats();
    this.postMessage('decode', {
      type: 'complete',
      fps: this.fps,
      frameCount: this.decodedFrames,
      queueSize: this.frameQueue.length
    });
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
        this.decoderManager.releaseFrame(frame);
      }
    });
    this.frameQueue = [];
  }

  postMemoryStats() {
    const stats = this.decoderManager.getStats();
    this.postMessage('memoryStats', {
      ...stats,
      workerQueueSize: this.frameQueue.length,
      decoder: this.decoderManager.getDecoderInfo()
    });
  }

  setResolution(width, height) {
    this.width = width;
    this.height = height;
    if (this.decoderManager) {
      this.decoderManager.setResolution(width, height);
    }
  }

  async switchDecoder(decoderType) {
    const success = await this.decoderManager.forceSwitchDecoder(decoderType);
    this.postMessage('decoderSwitch', {
      success,
      decoderType: this.decoderManager.getDecoderInfo()
    });
  }

  getAvailableDecoders() {
    const decoders = this.decoderManager.getAvailableDecoders();
    this.postMessage('availableDecoders', { decoders });
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
      case 'switchDecoder':
        this.switchDecoder(params.decoderType);
        break;
      case 'getAvailableDecoders':
        this.getAvailableDecoders();
        break;
      case 'getMemoryStats':
        this.postMemoryStats();
        break;
      case 'reset':
        this.isDecoding = false;
        this.clearAllFrames();
        this.currentIndex = 0;
        this.decodedFrames = 0;
        break;
    }
  }
}

const worker = new MultiDecoderWorker();
self.onmessage = (e) => worker.handleMessage(e);
