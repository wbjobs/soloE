import type { SimulationConfig, MouseState } from './types';

import advectionShader from '../shaders/advection.wgsl?raw';
import divergenceShader from '../shaders/divergence.wgsl?raw';
import pressureShader from '../shaders/pressure.wgsl?raw';
import gradientShader from '../shaders/gradient.wgsl?raw';
import mouseInputShader from '../shaders/mouse_input.wgsl?raw';
import boundaryVelocityShader from '../shaders/boundary_velocity.wgsl?raw';
import boundaryDensityShader from '../shaders/boundary_density.wgsl?raw';
import particleUpdateShader from '../shaders/particle_update.wgsl?raw';
import particleRenderShader from '../shaders/particle_render.wgsl?raw';
import renderShader from '../shaders/render.wgsl?raw';

export class FluidSimulation {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private config: SimulationConfig;
  
  private velocity!: [GPUTexture, GPUTexture];
  private density!: [GPUTexture, GPUTexture];
  private pressure!: [GPUTexture, GPUTexture];
  private divergence!: GPUTexture;
  
  private advectionPipeline!: GPUComputePipeline;
  private divergencePipeline!: GPUComputePipeline;
  private pressurePipeline!: GPUComputePipeline;
  private gradientPipeline!: GPUComputePipeline;
  private mouseInputPipeline!: GPUComputePipeline;
  private boundaryVelocityPipeline!: GPUComputePipeline;
  private boundaryDensityPipeline!: GPUComputePipeline;
  private particleUpdatePipeline!: GPUComputePipeline;
  private particleRenderPipeline!: GPURenderPipeline;
  private renderPipeline!: GPURenderPipeline;
  
  private particleBuffer!: GPUBuffer;
  private particleCount: number = 2048;
  private time: number = 0;
  
  private mouseState: MouseState = {
    position: [0.5, 0.5],
    delta: [0, 0],
    isDown: false,
    color: [0.0, 0.96, 0.83]
  };
  
  private colorIndex = 0;
  private colorPalette: [number, number, number][] = [
    [0.0, 0.96, 0.83],
    [0.0, 0.73, 0.98],
    [1.0, 0.42, 0.69],
    [0.99, 0.87, 0.31],
    [0.55, 0.27, 0.98]
  ];
  
  private readVelocity = 0;
  private readDensity = 0;
  private readPressure = 0;
  
  private texelSize!: Float32Array;
  
  constructor(canvas: HTMLCanvasElement, config?: Partial<SimulationConfig>) {
    this.canvas = canvas;
    this.config = {
      resolution: [512, 512],
      dt: 0.016,
      viscosity: 0.0,
      diffusion: 0.0,
      pressureIterations: 40,
      mouseForce: 5000.0,
      mouseRadius: 0.15,
      dissipation: 0.5,
      ...config
    };
    
    this.texelSize = new Float32Array([
      1.0 / this.config.resolution[0],
      1.0 / this.config.resolution[1]
    ]);
  }
  
  async init() {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get GPU adapter');
    }
    
    this.device = await adapter.requestDevice();
    
    this.context = this.canvas.getContext('webgpu')!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    
    this.context.configure({
      device: this.device,
      format,
      alphaMode: 'premultiplied'
    });
    
    this.createTextures();
    this.createPipelines(format);
    this.initParticles();
    this.setupEventListeners();
  }
  
  private initParticles() {
    const particleSize = 2 * 4 + 2 * 4;
    const bufferSize = this.particleCount * particleSize;
    
    this.particleBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    
    const particleData = new Float32Array(this.particleCount * 6);
    for (let i = 0; i < this.particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.3 + 0.1;
      const baseIdx = i * 6;
      
      particleData[baseIdx + 0] = 0.5 + Math.cos(angle) * radius;
      particleData[baseIdx + 1] = 0.5 + Math.sin(angle) * radius;
      particleData[baseIdx + 2] = 0;
      particleData[baseIdx + 3] = 0;
      particleData[baseIdx + 4] = Math.random() * 5 + 2;
      particleData[baseIdx + 5] = particleData[baseIdx + 4];
    }
    
    this.device.queue.writeBuffer(this.particleBuffer, 0, particleData);
  }
  
  private createTextures() {
    const [width, height] = this.config.resolution;
    
    const createTexture = (format: GPUTextureFormat) => {
      return this.device.createTexture({
        size: [width, height],
        format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST
      });
    };
    
    this.velocity = [
      createTexture('rg16float'),
      createTexture('rg16float')
    ];
    
    this.density = [
      createTexture('rgba16float'),
      createTexture('rgba16float')
    ];
    
    this.pressure = [
      createTexture('r16float'),
      createTexture('r16float')
    ];
    
    this.divergence = createTexture('r16float');
  }
  
  private createPipelines(format: GPUTextureFormat) {
    this.advectionPipeline = this.createComputePipeline(advectionShader);
    this.divergencePipeline = this.createComputePipeline(divergenceShader);
    this.pressurePipeline = this.createComputePipeline(pressureShader);
    this.gradientPipeline = this.createComputePipeline(gradientShader);
    this.mouseInputPipeline = this.createComputePipeline(mouseInputShader);
    this.boundaryVelocityPipeline = this.createComputePipeline(boundaryVelocityShader);
    this.boundaryDensityPipeline = this.createComputePipeline(boundaryDensityShader);
    this.particleUpdatePipeline = this.createComputePipeline(particleUpdateShader);
    
    this.renderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.device.createShaderModule({ code: renderShader }),
        entryPoint: 'vertex_main'
      },
      fragment: {
        module: this.device.createShaderModule({ code: renderShader }),
        entryPoint: 'fragment_main',
        targets: [{ format }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });
    
    this.particleRenderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.device.createShaderModule({ code: particleRenderShader }),
        entryPoint: 'vertex_main'
      },
      fragment: {
        module: this.device.createShaderModule({ code: particleRenderShader }),
        entryPoint: 'fragment_main',
        targets: [{
          format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one',
              operation: 'add'
            },
            alpha: {
              srcFactor: 'src-alpha',
              dstFactor: 'one',
              operation: 'add'
            }
          }
        }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });
  }
  
  private createComputePipeline(code: string): GPUComputePipeline {
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.device.createShaderModule({ code }),
        entryPoint: 'main'
      }
    });
  }
  
  private setupEventListeners() {
    const updateMousePos = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height;
      
      const dx = x - this.mouseState.position[0];
      const dy = y - this.mouseState.position[1];
      
      this.mouseState.delta = [dx, dy];
      this.mouseState.position = [x, y];
    };
    
    this.canvas.addEventListener('mousedown', (e) => {
      this.mouseState.isDown = true;
      updateMousePos(e);
      this.colorIndex = (this.colorIndex + 1) % this.colorPalette.length;
      this.mouseState.color = this.colorPalette[this.colorIndex];
    });
    
    this.canvas.addEventListener('mouseup', () => {
      this.mouseState.isDown = false;
    });
    
    this.canvas.addEventListener('mousemove', (e) => {
      updateMousePos(e);
    });
    
    this.canvas.addEventListener('mouseleave', () => {
      this.mouseState.isDown = false;
    });
  }
  
  private dispatch(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, bindGroups: GPUBindGroup[]) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    bindGroups.forEach((bg, i) => pass.setBindGroup(i, bg));
    pass.dispatchWorkgroups(
      Math.ceil(this.config.resolution[0] / 8),
      Math.ceil(this.config.resolution[1] / 8)
    );
    pass.end();
  }
  
  private swapVelocity() {
    this.readVelocity = 1 - this.readVelocity;
  }
  
  private swapDensity() {
    this.readDensity = 1 - this.readDensity;
  }
  
  private swapPressure() {
    this.readPressure = 1 - this.readPressure;
  }
  
  private createAdvectionBindGroup(inputVelocity: GPUTexture, inputQuantity: GPUTexture, outputTexture: GPUTexture): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.advectionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.createUniformBuffer(this.config.dt) } },
        { binding: 1, resource: { buffer: this.createUniformBuffer(this.config.dissipation) } },
        { binding: 2, resource: { buffer: this.createUniformBuffer(this.texelSize) } },
        { binding: 3, resource: inputVelocity.createView() },
        { binding: 4, resource: inputQuantity.createView() },
        { binding: 5, resource: outputTexture.createView() }
      ]
    });
  }
  
  private createUniformBuffer(data: number | Float32Array): GPUBuffer {
    const array = typeof data === 'number' ? new Float32Array([data]) : data;
    const buffer = this.device.createBuffer({
      size: array.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.device.queue.writeBuffer(buffer, 0, array as any);
    return buffer;
  }
  
  step() {
    const encoder = this.device.createCommandEncoder();
    
    if (this.mouseState.isDown) {
      this.applyMouseInput(encoder);
    }
    
    this.advectVelocity(encoder);
    this.applyBoundaryConditions(encoder, true);
    this.computeDivergence(encoder);
    this.solvePressure(encoder);
    this.applyPressureGradient(encoder);
    this.applyBoundaryConditions(encoder, true);
    this.advectDensity(encoder);
    this.applyBoundaryConditions(encoder, false);
    this.updateParticles(encoder);
    
    this.device.queue.submit([encoder.finish()]);
    this.time += this.config.dt;
  }
  
  private updateParticles(encoder: GPUCommandEncoder) {
    const bindGroup = this.device.createBindGroup({
      layout: this.particleUpdatePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: this.velocity[this.readVelocity].createView() },
        { binding: 2, resource: { buffer: this.createUniformBuffer(this.config.dt) } },
        { binding: 3, resource: { buffer: this.createUniformBuffer(this.time) } },
        { binding: 4, resource: { buffer: this.createUniformBuffer(this.texelSize) } }
      ]
    });
    
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.particleUpdatePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.particleCount / 64));
    pass.end();
  }
  
  private applyMouseInput(encoder: GPUCommandEncoder) {
    const applyToVelocity = this.device.createBindGroup({
      layout: this.mouseInputPipeline.getBindGroupLayout(0),
      entries: this.getMouseInputBindGroupEntries(this.velocity[this.readVelocity], this.velocity[1 - this.readVelocity], true)
    });
    
    const applyToDensity = this.device.createBindGroup({
      layout: this.mouseInputPipeline.getBindGroupLayout(0),
      entries: this.getMouseInputBindGroupEntries(this.density[this.readDensity], this.density[1 - this.readDensity], false)
    });
    
    this.dispatch(encoder, this.mouseInputPipeline, [applyToVelocity]);
    this.swapVelocity();
    
    this.dispatch(encoder, this.mouseInputPipeline, [applyToDensity]);
    this.swapDensity();
  }
  
  private applyBoundaryConditions(encoder: GPUCommandEncoder, isVelocity: boolean) {
    const inputTex = isVelocity ? this.velocity[this.readVelocity] : this.density[this.readDensity];
    const outputTex = isVelocity ? this.velocity[1 - this.readVelocity] : this.density[1 - this.readDensity];
    const pipeline = isVelocity ? this.boundaryVelocityPipeline : this.boundaryDensityPipeline;
    
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: inputTex.createView() },
        { binding: 1, resource: outputTex.createView() }
      ]
    });
    
    this.dispatch(encoder, pipeline, [bindGroup]);
    
    if (isVelocity) {
      this.swapVelocity();
    } else {
      this.swapDensity();
    }
  }
  
  private getMouseInputBindGroupEntries(inputTexture: GPUTexture, outputTexture: GPUTexture, isVelocity: boolean): GPUBindGroupEntry[] {
    return [
      { binding: 0, resource: { buffer: this.createUniformBuffer(new Float32Array(this.mouseState.position)) } },
      { binding: 1, resource: { buffer: this.createUniformBuffer(new Float32Array(this.mouseState.delta)) } },
      { binding: 2, resource: { buffer: this.createUniformBuffer(new Float32Array(this.mouseState.color)) } },
      { binding: 3, resource: { buffer: this.createUniformBuffer(this.config.mouseRadius) } },
      { binding: 4, resource: { buffer: this.createUniformBuffer(this.config.mouseForce) } },
      { binding: 5, resource: { buffer: this.createUniformBuffer(this.config.dt) } },
      { binding: 6, resource: { buffer: this.createUniformBuffer(isVelocity ? 1 : 0) } },
      { binding: 7, resource: inputTexture.createView() },
      { binding: 8, resource: outputTexture.createView() }
    ];
  }
  
  private advectVelocity(encoder: GPUCommandEncoder) {
    const bindGroup = this.createAdvectionBindGroup(
      this.velocity[this.readVelocity],
      this.velocity[this.readVelocity],
      this.velocity[1 - this.readVelocity]
    );
    this.dispatch(encoder, this.advectionPipeline, [bindGroup]);
    this.swapVelocity();
  }
  
  private advectDensity(encoder: GPUCommandEncoder) {
    const bindGroup = this.createAdvectionBindGroup(
      this.velocity[this.readVelocity],
      this.density[this.readDensity],
      this.density[1 - this.readDensity]
    );
    this.dispatch(encoder, this.advectionPipeline, [bindGroup]);
    this.swapDensity();
  }
  
  private computeDivergence(encoder: GPUCommandEncoder) {
    const bindGroup = this.device.createBindGroup({
      layout: this.divergencePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.createUniformBuffer(this.texelSize) } },
        { binding: 1, resource: this.velocity[this.readVelocity].createView() },
        { binding: 2, resource: this.divergence.createView() }
      ]
    });
    this.dispatch(encoder, this.divergencePipeline, [bindGroup]);
  }
  
  private solvePressure(encoder: GPUCommandEncoder) {
    const alpha = -1.0;
    const beta = 0.25;
    
    for (let i = 0; i < this.config.pressureIterations; i++) {
      const bindGroup = this.device.createBindGroup({
        layout: this.pressurePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.createUniformBuffer(alpha) } },
          { binding: 1, resource: { buffer: this.createUniformBuffer(beta) } },
          { binding: 2, resource: this.divergence.createView() },
          { binding: 3, resource: this.pressure[this.readPressure].createView() },
          { binding: 4, resource: this.pressure[1 - this.readPressure].createView() }
        ]
      });
      this.dispatch(encoder, this.pressurePipeline, [bindGroup]);
      this.swapPressure();
    }
  }
  
  private applyPressureGradient(encoder: GPUCommandEncoder) {
    const bindGroup = this.device.createBindGroup({
      layout: this.gradientPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.createUniformBuffer(this.texelSize) } },
        { binding: 1, resource: this.pressure[this.readPressure].createView() },
        { binding: 2, resource: this.velocity[this.readVelocity].createView() },
        { binding: 3, resource: this.velocity[1 - this.readVelocity].createView() }
      ]
    });
    this.dispatch(encoder, this.gradientPipeline, [bindGroup]);
    this.swapVelocity();
  }
  
  render() {
    const encoder = this.device.createCommandEncoder();
    
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0.04, g: 0.04, b: 0.06, a: 1.0 }
      }]
    });
    
    const bindGroup = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.density[this.readDensity].createView() },
        { binding: 1, resource: this.velocity[this.readVelocity].createView() }
      ]
    });
    
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(3);
    
    const particleBindGroup = this.device.createBindGroup({
      layout: this.particleRenderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.createUniformBuffer(new Float32Array([this.canvas.width, this.canvas.height])) } }
      ]
    });
    
    renderPass.setPipeline(this.particleRenderPipeline);
    renderPass.setBindGroup(0, particleBindGroup);
    renderPass.draw(6, this.particleCount);
    
    renderPass.end();
    
    this.device.queue.submit([encoder.finish()]);
  }
  
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
  }
}
