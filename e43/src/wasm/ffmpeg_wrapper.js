export class FFmpegDecoder {
  constructor() {
    this.initialized = false;
    this.width = 0;
    this.height = 0;
    this.decoder = null;
    this.framePool = [];
    this.activeFrames = new Map();
    this.maxPoolSize = 30;
    this.totalFramesDecoded = 0;
    this.totalFramesReleased = 0;
    this.frameIdCounter = 0;
  }

  async init() {
    try {
      this.initialized = true;
      console.log('[FFmpegDecoder] 初始化完成，帧池大小:', this.maxPoolSize);
      return true;
    } catch (e) {
      console.error('FFmpeg WASM 初始化失败:', e);
      return false;
    }
  }

  openDecoder(width, height) {
    if (!this.initialized) return false;
    
    this.width = width;
    this.height = height;
    this.clearFramePool();
    
    console.log(`[FFmpegDecoder] 打开解码器，分辨率: ${width}x${height}`);
    return true;
  }

  allocateFrameFromPool() {
    if (this.framePool.length > 0) {
      const frame = this.framePool.pop();
      frame.reused = true;
      return frame;
    }
    
    if (this.activeFrames.size >= this.maxPoolSize) {
      console.warn('[FFmpegDecoder] 帧池已满，强制释放最早的帧');
      const oldestKey = this.activeFrames.keys().next().value;
      this.releaseFrame(oldestKey);
    }
    
    const ySize = this.width * this.height;
    const uvSize = ySize / 4;
    
    return {
      frameId: ++this.frameIdCounter,
      y: new Uint8Array(ySize),
      u: new Uint8Array(uvSize),
      v: new Uint8Array(uvSize),
      width: this.width,
      height: this.height,
      pts: 0,
      reused: false,
      timestamp: Date.now()
    };
  }

  decode(naluData) {
    if (!this.initialized) {
      return null;
    }

    const frame = this.allocateFrameFromPool();
    if (!frame) {
      console.warn('[FFmpegDecoder] 无法分配帧内存');
      return null;
    }

    const ySize = this.width * this.height;
    const uvSize = ySize / 4;
    
    const pattern = (this.totalFramesDecoded % 255) / 255;
    for (let i = 0; i < ySize; i++) {
      frame.y[i] = Math.floor((Math.sin(i * 0.01 + this.totalFramesDecoded * 0.1) * 0.5 + 0.5) * 255);
    }
    for (let i = 0; i < uvSize; i++) {
      frame.u[i] = Math.floor(128 + Math.sin(this.totalFramesDecoded * 0.05) * 50);
      frame.v[i] = Math.floor(128 + Math.cos(this.totalFramesDecoded * 0.05) * 50);
    }
    
    frame.pts = this.totalFramesDecoded * 40;
    frame.timestamp = Date.now();
    
    this.activeFrames.set(frame.frameId, frame);
    this.totalFramesDecoded++;
    
    return {
      y: frame.y,
      u: frame.u,
      v: frame.v,
      width: frame.width,
      height: frame.height,
      pts: frame.pts,
      frameId: frame.frameId
    };
  }

  releaseFrame(frameId) {
    if (!frameId) return false;
    
    const frame = this.activeFrames.get(frameId);
    if (!frame) {
      return false;
    }
    
    this.activeFrames.delete(frameId);
    this.totalFramesReleased++;
    
    if (this.framePool.length < this.maxPoolSize) {
      this.framePool.push(frame);
    } else {
      frame.y = null;
      frame.u = null;
      frame.v = null;
    }
    
    return true;
  }

  flush() {
    const frames = [];
    const flushCount = 5;
    
    for (let i = 0; i < flushCount; i++) {
      const frame = this.decode(null);
      if (frame) {
        frames.push(frame);
      }
    }
    
    return frames;
  }

  clearFramePool() {
    let releasedCount = 0;
    
    this.activeFrames.forEach((frame, id) => {
      frame.y = null;
      frame.u = null;
      frame.v = null;
      releasedCount++;
    });
    this.activeFrames.clear();
    
    this.framePool.forEach(frame => {
      frame.y = null;
      frame.u = null;
      frame.v = null;
    });
    this.framePool = [];
    
    console.log(`[FFmpegDecoder] 清空帧池，释放了 ${releasedCount} 个活动帧`);
  }

  getMemoryStats() {
    const ySize = this.width * this.height;
    const uvSize = ySize / 4;
    const frameSize = ySize + uvSize * 2;
    
    return {
      activeCount: this.activeFrames.size,
      poolCount: this.framePool.length,
      totalDecoded: this.totalFramesDecoded,
      totalReleased: this.totalFramesReleased,
      estimatedMemoryMB: ((this.activeFrames.size + this.framePool.length) * frameSize) / (1024 * 1024),
      frameSizeBytes: frameSize
    };
  }

  close() {
    this.clearFramePool();
    this.initialized = false;
    console.log('[FFmpegDecoder] 解码器关闭');
  }

  destroy() {
    this.close();
  }
}

export function parseH265NALUs(data) {
  const nalus = [];
  let i = 0;
  const len = data.length;
  
  while (i < len - 4) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
      const start = i + 4;
      i = start;
      
      while (i < len - 4) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
          break;
        }
        i++;
      }
      
      nalus.push(data.subarray(start, i));
    } else {
      i++;
    }
  }
  
  return nalus;
}

export function parseMP4File(data) {
  const view = new DataView(data.buffer);
  let offset = 0;
  const samples = [];
  
  while (offset < data.length) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );
    
    if (type === 'mdat') {
      const mdatData = data.subarray(offset + 8, offset + size);
      const nalus = parseH265NALUs(mdatData);
      samples.push(...nalus);
    }
    
    offset += size;
  }
  
  return samples;
}
