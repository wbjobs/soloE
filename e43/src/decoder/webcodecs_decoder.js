export class WebCodecsDecoder {
  constructor(options = {}) {
    this.decoder = null;
    this.initialized = false;
    this.width = options.width || 1920;
    this.height = options.height || 1080;
    this.hardwareAcceleration = options.hardwareAcceleration || 'prefer-hardware';
    
    this.frameQueue = [];
    this.maxQueueSize = options.maxQueueSize || 30;
    this.frameIdCounter = 0;
    this.totalFramesDecoded = 0;
    this.totalFramesReleased = 0;
    
    this.onFrameCallback = options.onFrame || null;
    this.onErrorCallback = options.onError || null;
    
    this.framePool = [];
    this.activeFrames = new Map();
    this.maxPoolSize = 50;
  }

  async init() {
    try {
      if (typeof VideoDecoder === 'undefined') {
        throw new Error('WebCodecs VideoDecoder 不支持');
      }

      const config = {
        codec: 'hvc1.1.6.L120.B0',
        codedWidth: this.width,
        codedHeight: this.height,
        hardwareAcceleration: this.hardwareAcceleration
      };

      if (VideoDecoder.isConfigSupported) {
        const support = await VideoDecoder.isConfigSupported(config);
        if (!support.supported) {
          console.warn('HEVC 配置不支持，尝试使用默认配置');
          config.codec = 'hvc1.1.4.L120.B0';
        }
      }

      this.decoder = new VideoDecoder({
        output: (frame) => this.handleDecodedFrame(frame),
        error: (error) => this.handleError(error)
      });

      this.decoder.configure(config);
      this.initialized = true;
      
      console.log(`WebCodecs 解码器初始化成功 (${this.hardwareAcceleration})`);
      return true;
    } catch (e) {
      console.error('WebCodecs 解码器初始化失败:', e);
      return false;
    }
  }

  handleDecodedFrame(frame) {
    this.totalFramesDecoded++;
    
    const wrappedFrame = this.wrapFrame(frame);
    
    if (this.onFrameCallback) {
      this.onFrameCallback(wrappedFrame);
    } else {
      if (this.frameQueue.length >= this.maxQueueSize) {
        const droppedFrame = this.frameQueue.shift();
        this.releaseFrame(droppedFrame);
      }
      this.frameQueue.push(wrappedFrame);
    }
  }

  wrapFrame(videoFrame) {
    const frameId = ++this.frameIdCounter;
    
    const wrapped = {
      frameId,
      videoFrame,
      width: videoFrame.codedWidth,
      height: videoFrame.codedHeight,
      format: videoFrame.format,
      timestamp: videoFrame.timestamp,
      duration: videoFrame.duration,
      pts: videoFrame.timestamp
    };
    
    this.activeFrames.set(frameId, wrapped);
    return wrapped;
  }

  handleError(error) {
    console.error('WebCodecs 解码错误:', error);
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }
  }

  decode(naluData) {
    if (!this.initialized || !this.decoder) {
      return null;
    }

    try {
      const chunk = new EncodedVideoChunk({
        type: this.isKeyFrame(naluData) ? 'key' : 'delta',
        timestamp: performance.now() * 1000,
        duration: 33333,
        data: naluData
      });

      this.decoder.decode(chunk);
      return true;
    } catch (e) {
      console.error('解码帧失败:', e);
      return false;
    }
  }

  isKeyFrame(data) {
    if (data.length < 5) return false;
    
    const nalUnitType = (data[4] >> 1) & 0x3F;
    
    const keyFrameTypes = [16, 17, 18, 19, 20, 21];
    return keyFrameTypes.includes(nalUnitType);
  }

  async flush() {
    if (!this.decoder) return [];
    
    try {
      await this.decoder.flush();
    } catch (e) {
      console.warn('刷新解码器失败:', e);
    }
    
    return [...this.frameQueue];
  }

  releaseFrame(frame) {
    if (!frame) return false;
    
    const { frameId, videoFrame } = frame;
    
    if (this.activeFrames.has(frameId)) {
      this.activeFrames.delete(frameId);
      this.totalFramesReleased++;
      
      if (videoFrame && typeof videoFrame.close === 'function') {
        videoFrame.close();
      }
      
      return true;
    }
    
    return false;
  }

  releaseFrames(frameIds) {
    let released = 0;
    frameIds.forEach(id => {
      const frame = this.activeFrames.get(id);
      if (frame) {
        this.releaseFrame(frame);
        released++;
      }
    });
    return released;
  }

  clearFramePool() {
    this.frameQueue.forEach(frame => this.releaseFrame(frame));
    this.frameQueue = [];
    
    this.activeFrames.forEach((frame, id) => {
      this.releaseFrame(frame);
    });
    this.activeFrames.clear();
    
    this.framePool = [];
  }

  getStats() {
    return {
      activeCount: this.activeFrames.size,
      poolCount: this.framePool.length,
      queueSize: this.frameQueue.length,
      totalDecoded: this.totalFramesDecoded,
      totalReleased: this.totalFramesReleased,
      decoderState: this.decoder?.state || 'closed'
    };
  }

  close() {
    this.clearFramePool();
    
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch (e) {
        console.warn('关闭解码器时出错:', e);
      }
      this.decoder = null;
    }
    
    this.initialized = false;
  }

  destroy() {
    this.close();
  }

  setResolution(width, height) {
    this.width = width;
    this.height = height;
    
    if (this.initialized && this.decoder) {
      try {
        this.decoder.configure({
          codec: 'hvc1.1.6.L120.B0',
          codedWidth: width,
          codedHeight: height,
          hardwareAcceleration: this.hardwareAcceleration
        });
      } catch (e) {
        console.warn('重新配置解码器失败:', e);
      }
    }
  }

  requestFrame() {
    if (this.frameQueue.length > 0) {
      return this.frameQueue.shift();
    }
    return null;
  }
}

export default WebCodecsDecoder;
