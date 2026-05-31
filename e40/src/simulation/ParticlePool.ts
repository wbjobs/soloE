import { PARTICLE_POOL_SHADER } from '../shaders/particle_pool.wgsl';

export interface EmitRequest {
  position: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  strength: number;
  count: number;
}

export interface ParticlePoolStats {
  totalParticles: number;
  activeParticles: number;
  freeParticles: number;
  maxParticles: number;
}

export class ParticlePool {
  private device: GPUDevice;
  private maxParticles: number;
  private maxRenderDistance: number;
  
  private particleBuffer!: GPUBuffer;
  private freeListBuffer!: GPUBuffer;
  private freeListHeadBuffer!: GPUBuffer;
  private uniformBuffer!: GPUBuffer;
  private emitRequestBuffer!: GPUBuffer;
  
  private initPipeline!: GPUComputePipeline;
  private updatePipeline!: GPUComputePipeline;
  private emitPipeline!: GPUComputePipeline;
  
  private bindGroup!: GPUBindGroup;
  
  private pendingRequests: EmitRequest[] = [];
  private initialized = false;
  
  private stats: ParticlePoolStats;

  constructor(device: GPUDevice, maxParticles: number = 500000, maxRenderDistance: number = 5.0) {
    this.device = device;
    this.maxParticles = maxParticles;
    this.maxRenderDistance = maxRenderDistance;
    
    this.stats = {
      totalParticles: maxParticles,
      activeParticles: 0,
      freeParticles: maxParticles,
      maxParticles: maxParticles
    };
    
    this.createBuffers();
    this.createPipelines();
    this.createBindGroup();
  }

  private createBuffers(): void {
    const particleStride = 48;
    this.particleBuffer = this.device.createBuffer({
      size: this.maxParticles * particleStride,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    this.freeListBuffer = this.device.createBuffer({
      size: this.maxParticles * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    this.freeListHeadBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    this.uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    this.emitRequestBuffer = this.device.createBuffer({
      size: 8 * 48,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
  }

  private createPipelines(): void {
    const shaderModule = this.device.createShaderModule({
      code: PARTICLE_POOL_SHADER
    });
    
    const layout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.createBindGroupLayout()]
    });
    
    this.initPipeline = this.device.createComputePipeline({
      layout,
      compute: { module: shaderModule, entryPoint: 'initParticlePool' }
    });
    
    this.updatePipeline = this.device.createComputePipeline({
      layout,
      compute: { module: shaderModule, entryPoint: 'updateParticles' }
    });
    
    this.emitPipeline = this.device.createComputePipeline({
      layout,
      compute: { module: shaderModule, entryPoint: 'emitParticles' }
    });
  }

  private createBindGroupLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
      ]
    });
  }

  private createBindGroup(): void {
    this.bindGroup = this.device.createBindGroup({
      layout: this.initPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.freeListBuffer } },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: { buffer: this.emitRequestBuffer } },
        { binding: 4, resource: { buffer: this.freeListHeadBuffer } }
      ]
    });
  }

  initialize(commandEncoder: GPUCommandEncoder): void {
    if (this.initialized) return;
    
    const initialHead = new Uint32Array([this.maxParticles - 1]);
    this.device.queue.writeBuffer(this.freeListHeadBuffer, 0, initialHead);
    
    const initialUniforms = new Float32Array([
      this.maxParticles,
      this.maxRenderDistance,
      0, 0, 3,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, initialUniforms);
    
    const workgroups = Math.ceil(this.maxParticles / 256);
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.initPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    
    this.initialized = true;
  }

  update(
    dt: number,
    cameraPos: { x: number; y: number; z: number },
    wind: { x: number; y: number; z: number },
    dissipation: number,
    commandEncoder: GPUCommandEncoder
  ): void {
    const uniforms = new Float32Array([
      this.maxParticles,
      this.maxRenderDistance,
      cameraPos.x, cameraPos.y, cameraPos.z,
      dt,
      wind.x, wind.y, wind.z,
      dissipation,
      0, 0, 0, 0, 0, 0
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
    
    if (this.pendingRequests.length > 0) {
      const requestData = new Float32Array(8 * 12);
      this.pendingRequests.slice(0, 8).forEach((req, i) => {
        const base = i * 12;
        requestData[base + 0] = req.position.x;
        requestData[base + 1] = req.position.y;
        requestData[base + 2] = req.position.z;
        requestData[base + 3] = req.direction.x;
        requestData[base + 4] = req.direction.y;
        requestData[base + 5] = req.direction.z;
        requestData[base + 6] = req.strength;
        requestData[base + 7] = req.count;
      });
      this.device.queue.writeBuffer(this.emitRequestBuffer, 0, requestData);
      
      const emitPass = commandEncoder.beginComputePass();
      emitPass.setPipeline(this.emitPipeline);
      emitPass.setBindGroup(0, this.bindGroup);
      emitPass.dispatchWorkgroups(1);
      emitPass.end();
      
      this.pendingRequests = [];
    }
    
    const workgroups = Math.ceil(this.maxParticles / 256);
    const updatePass = commandEncoder.beginComputePass();
    updatePass.setPipeline(this.updatePipeline);
    updatePass.setBindGroup(0, this.bindGroup);
    updatePass.dispatchWorkgroups(workgroups);
    updatePass.end();
  }

  emit(request: EmitRequest): void {
    if (this.stats.freeParticles < request.count) {
      request.count = Math.min(request.count, Math.floor(this.stats.freeParticles * 0.8));
    }
    if (request.count > 0) {
      this.pendingRequests.push(request);
    }
  }

  getParticleBuffer(): GPUBuffer {
    return this.particleBuffer;
  }

  getStats(): ParticlePoolStats {
    return { ...this.stats };
  }

  getMaxParticles(): number {
    return this.maxParticles;
  }

  getMaxRenderDistance(): number {
    return this.maxRenderDistance;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
