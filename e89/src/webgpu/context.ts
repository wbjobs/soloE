export type DeviceLostCallback = (reason: GPUDeviceLostReason, message: string) => void;
export type DeviceRecoveredCallback = () => void;

export class WebGPUContext {
  private static instance: WebGPUContext | null = null;
  public device!: GPUDevice;
  public context!: GPUCanvasContext;
  public format!: GPUTextureFormat;
  public adapter!: GPUAdapter | null;

  private deviceLostCallbacks: Set<DeviceLostCallback> = new Set();
  private deviceRecoveredCallbacks: Set<DeviceRecoveredCallback> = new Set();
  private isRecovering: boolean = false;
  private canvas: HTMLCanvasElement | null = null;

  private constructor() {}

  static async getInstance(): Promise<WebGPUContext> {
    if (!WebGPUContext.instance) {
      WebGPUContext.instance = new WebGPUContext();
      await WebGPUContext.instance.initialize();
    }
    return WebGPUContext.instance;
  }

  static resetInstance(): void {
    if (WebGPUContext.instance) {
      WebGPUContext.instance.device?.destroy();
      WebGPUContext.instance = null;
    }
  }

  private async initialize(): Promise<void> {
    if (!navigator.gpu) {
      throw new Error('WebGPU 不受支持');
    }

    this.adapter = await navigator.gpu.requestAdapter();
    if (!this.adapter) {
      throw new Error('无法获取 GPU 适配器');
    }

    this.device = await this.adapter.requestDevice();
    if (!this.device) {
      throw new Error('无法获取 GPU 设备');
    }

    this.format = navigator.gpu.getPreferredCanvasFormat();

    this.setupDeviceLostHandler();
  }

  private setupDeviceLostHandler(): void {
    this.device.lost.then((info) => {
      console.warn('WebGPU 设备丢失:', info.reason, info.message);

      this.deviceLostCallbacks.forEach((cb) => {
        try {
          cb(info.reason, info.message);
        } catch (e) {
          console.error('设备丢失回调错误:', e);
        }
      });

      if (info.reason !== 'destroyed') {
        this.attemptRecovery();
      }
    });
  }

  private async attemptRecovery(): Promise<void> {
    if (this.isRecovering) return;
    this.isRecovering = true;

    console.log('正在尝试恢复 WebGPU 设备...');

    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount < maxRetries) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));

        WebGPUContext.resetInstance();
        const newContext = await WebGPUContext.getInstance();

        if (this.canvas) {
          newContext.setCanvas(this.canvas);
        }

        Object.assign(this, newContext);

        this.deviceRecoveredCallbacks.forEach((cb) => {
          try {
            cb();
          } catch (e) {
            console.error('设备恢复回调错误:', e);
          }
        });

        console.log('WebGPU 设备已恢复');
        this.isRecovering = false;
        return;
      } catch (e) {
        console.error(`恢复尝试 ${retryCount + 1} 失败:`, e);
        retryCount++;
      }
    }

    console.error('无法恢复 WebGPU 设备');
    this.isRecovering = false;
  }

  onDeviceLost(callback: DeviceLostCallback): () => void {
    this.deviceLostCallbacks.add(callback);
    return () => this.deviceLostCallbacks.delete(callback);
  }

  onDeviceRecovered(callback: DeviceRecoveredCallback): () => void {
    this.deviceRecoveredCallbacks.add(callback);
    return () => this.deviceRecoveredCallbacks.delete(callback);
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    if (!this.device) {
      console.warn('WebGPUContext: device 未初始化，无法配置 canvas');
      return;
    }
    this.canvas = canvas;
    this.context = canvas.getContext('webgpu')!;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });
  }

  createBuffer(data: BufferSource, usage: GPUBufferUsageFlags): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: (data.byteLength + 3) & ~3,
      usage,
      mappedAtCreation: true,
    });
    new (data.constructor as any)(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  createUniformBuffer(size: number): GPUBuffer {
    return this.device.createBuffer({
      size: (size + 255) & ~255,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  createStorageBuffer(size: number): GPUBuffer {
    return this.device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
  }

  writeBuffer(buffer: GPUBuffer, data: ArrayBufferView | ArrayBuffer, offset: number = 0): void {
    this.device.queue.writeBuffer(buffer, offset, data as BufferSource);
  }

  createComputePipeline(
    shaderModule: GPUShaderModule,
    bindGroupLayouts: GPUBindGroupLayout[],
    entryPoint: string = 'main'
  ): GPUComputePipeline {
    return this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts }),
      compute: { module: shaderModule, entryPoint },
    });
  }

  createRenderPipeline(
    shaderModule: GPUShaderModule,
    bindGroupLayouts: GPUBindGroupLayout[],
    vertexEntry: string = 'vs_main',
    fragmentEntry: string = 'fs_main',
    targets: GPUColorTargetState[] = [{ format: this.format }],
    primitive: GPUPrimitiveState = { topology: 'triangle-list' }
  ): GPURenderPipeline {
    return this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts }),
      vertex: { module: shaderModule, entryPoint: vertexEntry },
      fragment: { module: shaderModule, entryPoint: fragmentEntry, targets },
      primitive,
    });
  }

  createBindGroup(
    layout: GPUBindGroupLayout,
    entries: GPUBindGroupEntry[]
  ): GPUBindGroup {
    return this.device.createBindGroup({ layout, entries });
  }

  createBindGroupLayout(
    entries: GPUBindGroupLayoutEntry[]
  ): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({ entries });
  }

  createShaderModule(code: string): GPUShaderModule {
    return this.device.createShaderModule({ code });
  }

  createSampler(descriptor: GPUSamplerDescriptor = {}): GPUSampler {
    return this.device.createSampler(descriptor);
  }

  createTexture(
    width: number,
    height: number,
    format: GPUTextureFormat = 'rgba8unorm',
    usage: GPUTextureUsageFlags = GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  ): GPUTexture {
    return this.device.createTexture({
      size: { width, height },
      format,
      usage,
    });
  }

  isDeviceLost(): boolean {
    return this.isRecovering || this.device.lost !== undefined;
  }
}
