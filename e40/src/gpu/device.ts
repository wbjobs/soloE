export class WebGPUDevice {
  private static instance: WebGPUDevice;
  private _device!: GPUDevice;
  private _context!: GPUCanvasContext;
  private _format!: GPUTextureFormat;
  private _initialized = false;

  private constructor() {}

  static getInstance(): WebGPUDevice {
    if (!WebGPUDevice.instance) {
      WebGPUDevice.instance = new WebGPUDevice();
    }
    return WebGPUDevice.instance;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this._initialized) return;

    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });
    
    if (!adapter) {
      throw new Error('Failed to find a suitable GPU adapter');
    }

    this._device = await adapter.requestDevice({
      requiredFeatures: ['timestamp-query']
    });

    this._context = canvas.getContext('webgpu')!;
    this._format = navigator.gpu.getPreferredCanvasFormat();
    
    this._context.configure({
      device: this._device,
      format: this._format,
      alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST
    });

    this.resize(canvas.width, canvas.height);
    this._initialized = true;
  }

  resize(_width: number, _height: number): void {
    if (!this._context) return;
  }

  get device(): GPUDevice {
    return this._device;
  }

  get context(): GPUCanvasContext {
    return this._context;
  }

  get format(): GPUTextureFormat {
    return this._format;
  }

  get initialized(): boolean {
    return this._initialized;
  }
}
