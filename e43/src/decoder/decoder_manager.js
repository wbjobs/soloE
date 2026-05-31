import { CapabilityDetector } from './capability_detector.js';
import { WebCodecsDecoder } from './webcodecs_decoder.js';
import { FFmpegDecoder } from '../wasm/ffmpeg_wrapper.js';

export class DecoderManager {
  constructor(options = {}) {
    this.currentDecoder = null;
    this.currentDecoderType = null;
    this.capabilityDetector = new CapabilityDetector();
    this.capabilities = null;
    
    this.onFrameCallback = options.onFrame || null;
    this.onErrorCallback = options.onError || null;
    this.onDecoderChangeCallback = options.onDecoderChange || null;
    
    this.width = options.width || 1920;
    this.height = options.height || 1080;
    this.maxQueueSize = options.maxQueueSize || 30;
    
    this.frameQueue = [];
    this.frameIdCounter = 0;
    this.isDecoding = false;
    
    this.decoderSwitchAttempts = 0;
    this.maxSwitchAttempts = 3;
    this.lastSwitchTime = 0;
    this.minSwitchInterval = 5000;
  }

  async init() {
    try {
      this.capabilities = await this.capabilityDetector.detectAll();
      console.log('浏览器能力检测结果:', this.capabilities);
      
      const decoderType = this.capabilities.preferredDecoder;
      
      const success = await this.switchDecoder(decoderType);
      if (!success) {
        console.warn('首选解码器初始化失败，尝试 fallback');
        return await this.tryFallbackDecoder(decoderType);
      }
      
      return true;
    } catch (e) {
      console.error('解码器管理器初始化失败:', e);
      return false;
    }
  }

  async switchDecoder(decoderType) {
    const now = Date.now();
    if (now - this.lastSwitchTime < this.minSwitchInterval && this.currentDecoder) {
      console.warn('解码器切换过于频繁，已跳过');
      return false;
    }
    
    this.lastSwitchTime = now;
    this.decoderSwitchAttempts++;
    
    console.log(`切换解码器: ${this.currentDecoderType} -> ${decoderType}`);
    
    if (this.currentDecoder) {
      try {
        this.currentDecoder.close();
      } catch (e) {
        console.warn('关闭旧解码器时出错:', e);
      }
    }
    
    this.frameQueue = [];
    
    let success = false;
    
    switch (decoderType) {
      case 'webcodecs-hw':
        success = await this.initWebCodecsDecoder('prefer-hardware');
        break;
      case 'webcodecs-sw':
        success = await this.initWebCodecsDecoder('prefer-software');
        break;
      case 'wasm':
        success = await this.initWasmDecoder();
        break;
      default:
        console.error('未知的解码器类型:', decoderType);
        return false;
    }
    
    if (success) {
      this.currentDecoderType = decoderType;
      if (this.onDecoderChangeCallback) {
        this.onDecoderChangeCallback(decoderType, this.getDecoderInfo());
      }
    }
    
    return success;
  }

  async tryFallbackDecoder(failedType) {
    const fallbackOrder = ['webcodecs-hw', 'webcodecs-sw', 'wasm'];
    const startIndex = fallbackOrder.indexOf(failedType) + 1;
    
    for (let i = startIndex; i < fallbackOrder.length; i++) {
      const fallbackType = fallbackOrder[i];
      
      if (this.isDecoderAvailable(fallbackType)) {
        console.log(`尝试 fallback 解码器: ${fallbackType}`);
        const success = await this.switchDecoder(fallbackType);
        if (success) return true;
      }
    }
    
    console.error('所有解码器都不可用');
    return false;
  }

  isDecoderAvailable(decoderType) {
    if (!this.capabilities) return false;
    
    switch (decoderType) {
      case 'webcodecs-hw':
        return this.capabilities.webCodecs.supported && this.capabilities.hevcSupport.hardware;
      case 'webcodecs-sw':
        return this.capabilities.webCodecs.supported && this.capabilities.hevcSupport.software;
      case 'wasm':
        return this.capabilities.wasm.supported;
      default:
        return false;
    }
  }

  async initWebCodecsDecoder(hardwareAcceleration) {
    try {
      const decoder = new WebCodecsDecoder({
        width: this.width,
        height: this.height,
        hardwareAcceleration,
        maxQueueSize: this.maxQueueSize,
        onFrame: (frame) => this.handleFrame(frame),
        onError: (error) => this.handleDecoderError(error, 'webcodecs')
      });
      
      const success = await decoder.init();
      if (success) {
        this.currentDecoder = decoder;
      }
      return success;
    } catch (e) {
      console.error('WebCodecs 解码器初始化失败:', e);
      return false;
    }
  }

  async initWasmDecoder() {
    try {
      const decoder = new FFmpegDecoder();
      const success = await decoder.init();
      
      if (success) {
        const openSuccess = decoder.openDecoder(this.width, this.height);
        if (openSuccess) {
          this.currentDecoder = decoder;
          return true;
        }
      }
      return false;
    } catch (e) {
      console.error('WASM 解码器初始化失败:', e);
      return false;
    }
  }

  handleFrame(frame) {
    if (this.onFrameCallback) {
      this.onFrameCallback(frame);
    } else {
      if (this.frameQueue.length >= this.maxQueueSize) {
        const dropped = this.frameQueue.shift();
        this.releaseFrame(dropped);
      }
      this.frameQueue.push(frame);
    }
  }

  handleDecoderError(error, decoderType) {
    console.error(`${decoderType} 解码器错误:`, error);
    
    if (this.onErrorCallback) {
      this.onErrorCallback(error, decoderType);
    }
    
    if (this.decoderSwitchAttempts < this.maxSwitchAttempts) {
      setTimeout(() => {
        this.tryFallbackDecoder(this.currentDecoderType);
      }, 1000);
    }
  }

  decode(naluData) {
    if (!this.currentDecoder) {
      console.warn('没有可用的解码器');
      return null;
    }
    
    try {
      const result = this.currentDecoder.decode(naluData);
      
      if (result === null || result === false) {
        if (this.decoderSwitchAttempts < this.maxSwitchAttempts) {
          console.log('解码失败，尝试切换解码器');
          this.tryFallbackDecoder(this.currentDecoderType);
        }
      }
      
      return result;
    } catch (e) {
      console.error('解码异常:', e);
      return null;
    }
  }

  async flush() {
    if (!this.currentDecoder) return [];
    return await this.currentDecoder.flush();
  }

  releaseFrame(frame) {
    if (!this.currentDecoder) return false;
    return this.currentDecoder.releaseFrame(frame);
  }

  releaseFrames(frameIds) {
    if (!this.currentDecoder) return 0;
    return this.currentDecoder.releaseFrames(frameIds);
  }

  requestFrame() {
    if (this.frameQueue.length > 0) {
      return this.frameQueue.shift();
    }
    
    if (this.currentDecoder && typeof this.currentDecoder.requestFrame === 'function') {
      return this.currentDecoder.requestFrame();
    }
    
    return null;
  }

  getStats() {
    if (!this.currentDecoder) {
      return {
        activeCount: 0,
        poolCount: 0,
        queueSize: 0,
        totalDecoded: 0,
        totalReleased: 0,
        decoderType: this.currentDecoderType || 'none'
      };
    }
    
    const stats = this.currentDecoder.getStats ? this.currentDecoder.getStats() : {};
    return {
      ...stats,
      decoderType: this.currentDecoderType,
      frameQueueSize: this.frameQueue.length,
      switchAttempts: this.decoderSwitchAttempts
    };
  }

  getDecoderInfo() {
    const type = this.currentDecoderType;
    const names = {
      'webcodecs-hw': 'GPU 硬件加速',
      'webcodecs-sw': 'CPU 软件解码',
      'wasm': 'FFmpeg WASM 软解',
      'none': '无可用解码器'
    };
    
    const icons = {
      'webcodecs-hw': '⚡',
      'webcodecs-sw': '💻',
      'wasm': '🔧',
      'none': '❌'
    };
    
    return {
      type,
      name: names[type] || '未知',
      icon: icons[type] || '❓',
      isHardwareAccelerated: type === 'webcodecs-hw',
      capabilities: this.capabilities
    };
  }

  setResolution(width, height) {
    this.width = width;
    this.height = height;
    
    if (this.currentDecoder && typeof this.currentDecoder.setResolution === 'function') {
      this.currentDecoder.setResolution(width, height);
    }
  }

  close() {
    if (this.currentDecoder) {
      try {
        this.currentDecoder.close();
      } catch (e) {
        console.warn('关闭解码器时出错:', e);
      }
      this.currentDecoder = null;
    }
    
    this.frameQueue = [];
    this.currentDecoderType = null;
  }

  destroy() {
    this.close();
  }

  getAvailableDecoders() {
    if (!this.capabilities) return [];
    
    const decoders = [];
    
    if (this.capabilities.webCodecs.supported && this.capabilities.hevcSupport.hardware) {
      decoders.push({
        type: 'webcodecs-hw',
        name: 'WebCodecs (GPU 硬件加速)',
        preferred: true
      });
    }
    
    if (this.capabilities.webCodecs.supported && this.capabilities.hevcSupport.software) {
      decoders.push({
        type: 'webcodecs-sw',
        name: 'WebCodecs (CPU 软件解码)',
        preferred: !this.capabilities.hevcSupport.hardware
      });
    }
    
    if (this.capabilities.wasm.supported) {
      decoders.push({
        type: 'wasm',
        name: 'FFmpeg WASM 软解',
        preferred: decoders.length === 0
      });
    }
    
    return decoders;
  }

  async forceSwitchDecoder(decoderType) {
    this.decoderSwitchAttempts = 0;
    return await this.switchDecoder(decoderType);
  }
}

export default DecoderManager;
