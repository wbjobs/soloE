export class CapabilityDetector {
  constructor() {
    this.cachedResults = null;
    this.checkInProgress = false;
  }

  async detectAll() {
    if (this.cachedResults) {
      return this.cachedResults;
    }

    if (this.checkInProgress) {
      return new Promise(resolve => {
        const interval = setInterval(() => {
          if (this.cachedResults) {
            clearInterval(interval);
            resolve(this.cachedResults);
          }
        }, 100);
      });
    }

    this.checkInProgress = true;

    const results = {
      webGPU: await this.checkWebGPU(),
      webCodecs: await this.checkWebCodecs(),
      webGL: await this.checkWebGL(),
      wasm: await this.checkWASM(),
      hevcSupport: {
        hardware: false,
        software: false
      }
    };

    if (results.webCodecs.supported) {
      results.hevcSupport = await this.checkHEVCSupport();
    }

    results.preferredDecoder = this.getPreferredDecoder(results);
    this.cachedResults = results;
    this.checkInProgress = false;

    return results;
  }

  async checkWebGPU() {
    if (!navigator.gpu) {
      return {
        supported: false,
        reason: 'navigator.gpu 不存在'
      };
    }

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return {
          supported: false,
          reason: '无法获取 GPU 适配器'
        };
      }

      const device = await adapter.requestDevice();
      if (device) {
        device.destroy();
      }

      return {
        supported: true,
        adapter: adapter.name || 'Unknown',
        vendor: adapter.vendor || 'Unknown'
      };
    } catch (e) {
      return {
        supported: false,
        reason: e.message
      };
    }
  }

  async checkWebCodecs() {
    if (typeof VideoDecoder === 'undefined') {
      return {
        supported: false,
        reason: 'VideoDecoder API 不存在'
      };
    }

    try {
      const isConfigSupported = typeof VideoDecoder.isConfigSupported === 'function';
      
      return {
        supported: true,
        isConfigSupported,
        hardwareAcceleration: 'geolocation' in navigator
      };
    } catch (e) {
      return {
        supported: false,
        reason: e.message
      };
    }
  }

  async checkWebGL() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      
      if (!gl) {
        return {
          supported: false,
          reason: '无法创建 WebGL 上下文'
        };
      }

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown';
      
      return {
        supported: true,
        version: gl.getParameter(gl.VERSION),
        renderer: renderer
      };
    } catch (e) {
      return {
        supported: false,
        reason: e.message
      };
    }
  }

  async checkWASM() {
    try {
      const wasmSupported = typeof WebAssembly === 'object' &&
        WebAssembly.validate(new Uint8Array([0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));

      const simdSupported = await this.checkSIMDSupport();
      const threadsSupported = typeof SharedArrayBuffer !== 'undefined';

      return {
        supported: wasmSupported,
        simd: simdSupported,
        threads: threadsSupported
      };
    } catch (e) {
      return {
        supported: false,
        reason: e.message
      };
    }
  }

  async checkSIMDSupport() {
    try {
      if (typeof WebAssembly === 'undefined') return false;
      
      const simdModule = new Uint8Array([
        0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7B,
        0x03, 0x02, 0x01, 0x00,
        0x0A, 0x0A, 0x01, 0x08, 0x00,
        0x41, 0x00,
        0xFD, 0x0F,
        0x0B
      ]);

      await WebAssembly.instantiate(simdModule);
      return true;
    } catch (e) {
      return false;
    }
  }

  async checkHEVCSupport() {
    const result = {
      hardware: false,
      software: false
    };

    if (typeof VideoDecoder === 'undefined' || !VideoDecoder.isConfigSupported) {
      return result;
    }

    try {
      const hwConfig = {
        codec: 'hvc1.1.6.L120.B0',
        hardwareAcceleration: 'prefer-hardware'
      };

      const hwSupport = await VideoDecoder.isConfigSupported(hwConfig);
      result.hardware = hwSupport.supported;

      const swConfig = {
        codec: 'hvc1.1.6.L120.B0',
        hardwareAcceleration: 'prefer-software'
      };

      const swSupport = await VideoDecoder.isConfigSupported(swConfig);
      result.software = swSupport.supported;
    } catch (e) {
      console.warn('HEVC 支持检测失败:', e);
    }

    return result;
  }

  getPreferredDecoder(capabilities) {
    if (capabilities.webCodecs.supported && capabilities.hevcSupport.hardware) {
      return 'webcodecs-hw';
    }

    if (capabilities.webCodecs.supported && capabilities.hevcSupport.software) {
      return 'webcodecs-sw';
    }

    if (capabilities.wasm.supported) {
      return 'wasm';
    }

    return 'none';
  }

  getDecoderName(type) {
    const names = {
      'webcodecs-hw': 'WebCodecs (GPU 硬件加速)',
      'webcodecs-sw': 'WebCodecs (CPU 软解)',
      'wasm': 'FFmpeg WASM 软解',
      'none': '无可用解码器'
    };
    return names[type] || '未知';
  }

  clearCache() {
    this.cachedResults = null;
  }
}

export const detector = new CapabilityDetector();
