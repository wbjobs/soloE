import { PARTICLE_RENDER_OPTIMIZED_SHADER, CUBE_RENDER_SHADER } from '../shaders/particle_pool.wgsl';
import { Matrix4, vec3 } from '../utils/math';

export class ParticleRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private maxParticles: number;
  
  private particlePipeline!: GPURenderPipeline;
  private cubePipeline!: GPURenderPipeline;
  
  private uniformBuffer!: GPUBuffer;
  private bindGroup: GPUBindGroup | null = null;
  
  private depthTexture!: GPUTexture;
  
  private cameraRotationX = 0.5;
  private cameraRotationY = 0;
  private cameraDistance = 3;
  private targetRotationX = 0.5;
  private targetRotationY = 0;
  private targetDistance = 3;
  
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  constructor(
    device: GPUDevice, 
    context: GPUCanvasContext, 
    format: GPUTextureFormat,
    maxParticles: number = 500000
  ) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.maxParticles = maxParticles;
    
    this.createUniformBuffer();
    this.createPipelines();
    this.createDepthTexture();
    this.setupInputHandlers();
  }

  private createUniformBuffer(): void {
    this.uniformBuffer = this.device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  private createPipelines(): void {
    const particleShader = this.device.createShaderModule({ 
      code: PARTICLE_RENDER_OPTIMIZED_SHADER 
    });
    const cubeShader = this.device.createShaderModule({ 
      code: CUBE_RENDER_SHADER 
    });
    
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }
      ]
    });
    
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });
    
    this.particlePipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: particleShader, entryPoint: 'vs_main' },
      fragment: {
        module: particleShader,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one' },
            alpha: { srcFactor: 'src-alpha', dstFactor: 'one' }
          }
        }]
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus'
      }
    });
    
    this.cubePipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: cubeShader, entryPoint: 'vs_main' },
      fragment: {
        module: cubeShader,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }
          }
        }]
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus'
      }
    });
  }

  private createDepthTexture(): void {
    const canvas = this.context.canvas as HTMLCanvasElement;
    this.depthTexture = this.device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
  }

  private setupInputHandlers(): void {
    const canvas = this.context.canvas as HTMLCanvasElement;
    
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });
    
    canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging && e.buttons === 1) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.targetRotationY += dx * 0.005;
        this.targetRotationX += dy * 0.005;
        this.targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.targetRotationX));
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });
    
    canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
    
    canvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
    });
    
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetDistance += e.deltaY * 0.002;
      this.targetDistance = Math.max(1.5, Math.min(10, this.targetDistance));
    }, { passive: false });
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number; z: number } {
    const canvas = this.context.canvas as HTMLCanvasElement;
    const ndcX = (screenX / canvas.width) * 2 - 1;
    const ndcY = -(screenY / canvas.height) * 2 + 1;
    
    const depth = 0.5;
    const x = ndcX * 0.6;
    const y = ndcY * 0.6;
    
    const cosY = Math.cos(-this.cameraRotationY);
    const sinY = Math.sin(-this.cameraRotationY);
    const cosX = Math.cos(-this.cameraRotationX);
    const sinX = Math.sin(-this.cameraRotationX);
    
    const rotatedX = x * cosY - depth * sinY;
    const rotatedZ = x * sinY + depth * cosY;
    const rotatedY = y * cosX - rotatedZ * sinX;
    const finalZ = y * sinX + rotatedZ * cosX;
    
    return { 
      x: (rotatedX + 1) / 2, 
      y: (rotatedY + 1) / 2, 
      z: (finalZ + 1) / 2 
    };
  }

  getCameraPosition(): { x: number; y: number; z: number } {
    const camX = Math.sin(this.cameraRotationY) * Math.cos(this.cameraRotationX) * this.cameraDistance;
    const camY = Math.sin(this.cameraRotationX) * this.cameraDistance;
    const camZ = Math.cos(this.cameraRotationY) * Math.cos(this.cameraRotationX) * this.cameraDistance;
    return { x: camX, y: camY, z: camZ };
  }

  resize(): void {
    this.createDepthTexture();
  }

  render(
    particleBuffer: GPUBuffer,
    maxRenderDistance: number,
    time: number,
    commandEncoder: GPUCommandEncoder
  ): void {
    this.cameraRotationX += (this.targetRotationX - this.cameraRotationX) * 0.1;
    this.cameraRotationY += (this.targetRotationY - this.cameraRotationY) * 0.1;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * 0.1;
    
    const canvas = this.context.canvas as HTMLCanvasElement;
    const aspect = canvas.width / canvas.height;
    
    const proj = new Matrix4().perspective(Math.PI / 4, aspect, 0.1, 100);
    const view = new Matrix4();
    
    const camX = Math.sin(this.cameraRotationY) * Math.cos(this.cameraRotationX) * this.cameraDistance;
    const camY = Math.sin(this.cameraRotationX) * this.cameraDistance;
    const camZ = Math.cos(this.cameraRotationY) * Math.cos(this.cameraRotationX) * this.cameraDistance;
    
    view.lookAt(vec3.create(camX, camY, camZ), vec3.create(0, 0, 0), vec3.create(0, 1, 0));
    
    const viewProj = proj.multiply(view);
    
    const uniforms = new Float32Array(32);
    uniforms.set(viewProj.toArray(), 0);
    uniforms[16] = camX;
    uniforms[17] = camY;
    uniforms[18] = camZ;
    uniforms[19] = 1.2;
    uniforms[20] = maxRenderDistance;
    uniforms[21] = time;
    
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
    
    this.bindGroup = this.device.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: particleBuffer } }
      ]
    });
    
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    });
    
    pass.setPipeline(this.cubePipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(24);
    
    pass.setPipeline(this.particlePipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, this.maxParticles);
    
    pass.end();
  }
}
