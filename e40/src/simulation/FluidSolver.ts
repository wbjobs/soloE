import { FLUID_COMPUTE_SHADER } from '../shaders/fluid.wgsl';
import { GRID_SIZE, GRID_CELLS, FluidParams, Emitter } from '../types';

export class FluidSolver {
  private device: GPUDevice;
  
  private velocityBuffer!: GPUBuffer;
  private densityBuffer!: GPUBuffer;
  private pressureBuffer!: GPUBuffer;
  private paramsBuffer!: GPUBuffer;
  private emittersBuffer!: GPUBuffer;
  
  private advectionPipeline!: GPUComputePipeline;
  private diffusionPipeline!: GPUComputePipeline;
  private divergencePipeline!: GPUComputePipeline;
  private pressureSolvePipeline!: GPUComputePipeline;
  private gradientSubtractPipeline!: GPUComputePipeline;
  private emissionPipeline!: GPUComputePipeline;
  
  private bindGroup!: GPUBindGroup;
  
  private params: FluidParams;
  private emitters: Emitter[] = [];
  private maxEmitters = 32;

  constructor(device: GPUDevice) {
    this.device = device;
    this.params = {
      windX: 0,
      windY: 0,
      windZ: 0,
      diffusion: 0.1,
      dissipation: 0.02,
      emissionStrength: 5
    };
    
    this.createBuffers();
    this.createPipelines();
    this.createBindGroup();
  }

  private createBuffers(): void {
    const bufferSize = GRID_CELLS * 4;
    
    this.velocityBuffer = this.device.createBuffer({
      size: bufferSize * 3,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    this.densityBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    this.pressureBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    this.paramsBuffer = this.device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    
    this.emittersBuffer = this.device.createBuffer({
      size: this.maxEmitters * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    const zeroVelocity = new Float32Array(GRID_CELLS * 3);
    const zeroDensity = new Float32Array(GRID_CELLS);
    
    this.device.queue.writeBuffer(this.velocityBuffer, 0, zeroVelocity);
    this.device.queue.writeBuffer(this.densityBuffer, 0, zeroDensity);
    this.device.queue.writeBuffer(this.pressureBuffer, 0, zeroDensity);
  }

  private createPipelines(): void {
    const shaderModule = this.device.createShaderModule({
      code: FLUID_COMPUTE_SHADER
    });
    
    const layout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.createBindGroupLayout()]
    });
    
    this.advectionPipeline = this.device.createComputePipeline({
      layout,
      compute: { module: shaderModule, entryPoint: 'advection' }
    });
    
    this.diffusionPipeline = this.device.createComputePipeline({
      layout,
      compute: { module: shaderModule, entryPoint: 'diffusion' }
    });
    
    this.divergencePipeline = this.device.createComputePipeline({
      layout,
      compute: { module: shaderModule, entryPoint: 'divergence' }
    });
    
    this.pressureSolvePipeline = this.device.createComputePipeline({
      layout,
      compute: { module: shaderModule, entryPoint: 'pressureSolve' }
    });
    
    this.gradientSubtractPipeline = this.device.createComputePipeline({
      layout,
      compute: { module: shaderModule, entryPoint: 'gradientSubtract' }
    });
    
    this.emissionPipeline = this.device.createComputePipeline({
      layout,
      compute: { module: shaderModule, entryPoint: 'emission' }
    });
  }

  private createBindGroupLayout(): GPUBindGroupLayout {
    return this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }
      ]
    });
  }

  private createBindGroup(): void {
    this.bindGroup = this.device.createBindGroup({
      layout: this.advectionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.velocityBuffer } },
        { binding: 1, resource: { buffer: this.densityBuffer } },
        { binding: 2, resource: { buffer: this.pressureBuffer } },
        { binding: 3, resource: { buffer: this.paramsBuffer } },
        { binding: 4, resource: { buffer: this.emittersBuffer } }
      ]
    });
  }

  addEmitter(emitter: Emitter): void {
    this.emitters.push(emitter);
    if (this.emitters.length > this.maxEmitters) {
      this.emitters.shift();
    }
  }

  setParams(params: Partial<FluidParams>): void {
    Object.assign(this.params, params);
  }

  update(dt: number, commandEncoder: GPUCommandEncoder): void {
    const paramsData = new Float32Array([
      GRID_SIZE,
      dt,
      this.params.diffusion,
      this.params.dissipation,
      this.params.windX,
      this.params.windY,
      this.params.windZ,
      this.emitters.length,
      0, 0
    ]);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);
    
    const emittersData = new Float32Array(this.maxEmitters * 8);
    this.emitters.forEach((e, i) => {
      const base = i * 8;
      emittersData[base + 0] = e.position.x;
      emittersData[base + 1] = e.position.y;
      emittersData[base + 2] = e.position.z;
      emittersData[base + 3] = e.radius;
      emittersData[base + 4] = e.strength;
      emittersData[base + 5] = e.lifetime;
    });
    this.device.queue.writeBuffer(this.emittersBuffer, 0, emittersData);
    
    this.emitters = this.emitters.filter(e => {
      e.lifetime -= dt;
      return e.lifetime > 0;
    });
    
    const workgroups = Math.ceil(GRID_SIZE / 8);
    
    let pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.emissionPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
    
    pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.advectionPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
    
    for (let i = 0; i < 4; i++) {
      pass = commandEncoder.beginComputePass();
      pass.setPipeline(this.diffusionPipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
      pass.end();
    }
    
    pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.divergencePipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
    
    for (let i = 0; i < 20; i++) {
      pass = commandEncoder.beginComputePass();
      pass.setPipeline(this.pressureSolvePipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
      pass.end();
    }
    
    pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.gradientSubtractPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
    pass.end();
  }

  getDensityBuffer(): GPUBuffer {
    return this.densityBuffer;
  }

  getVelocityBuffer(): GPUBuffer {
    return this.velocityBuffer;
  }

  getActiveEmitterCount(): number {
    return this.emitters.length;
  }
}
