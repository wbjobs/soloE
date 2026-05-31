import { WebGPUContext } from '../webgpu/context';
import { Camera, RenderSettings, PerformanceMetrics, Vec3 } from '../types';
import { RAYTRACE_SHADER } from '../shaders/raytrace.wgsl';
import { BVH_VISUALIZE_SHADER, COMPOSITE_SHADER } from '../shaders/bvhVisualize.wgsl';

export class RayTracer {
  private context: WebGPUContext;
  private width: number;
  private height: number;

  private raytracePipeline!: GPUComputePipeline;
  private bvhVisualizePipeline!: GPURenderPipeline;
  private compositePipeline!: GPURenderPipeline;

  private raytraceBindGroup!: GPUBindGroup;
  private bvhVisualizeBindGroup!: GPUBindGroup;
  private compositeBindGroup!: GPUBindGroup;

  private cameraUniformBuffer!: GPUBuffer;
  private settingsUniformBuffer!: GPUBuffer;
  private bvhLevelUniformBuffer!: GPUBuffer;
  private showBVHUniformBuffer!: GPUBuffer;
  private bvhCameraUniformBuffer!: GPUBuffer;

  private raytraceTexture!: GPUTexture;
  private bvhRenderTexture!: GPUTexture;
  private bvhDepthTexture!: GPUTexture;
  private traversalCountBuffer!: GPUBuffer;
  private readbackBuffer!: GPUBuffer;

  private frame: number = 0;
  private frameTimes: number[] = [];
  private lastFrameTime: number = 0;

  private bvhNodesBuffer!: GPUBuffer;
  private voxelBuffer!: GPUBuffer;
  private bvhNodeCount: number = 0;

  private cameraData: Float32Array;
  private settingsData: Uint32Array;
  private clearTraversalNextFrame: boolean = true;
  private isInitialized: boolean = false;

  constructor(context: WebGPUContext, width: number, height: number) {
    this.context = context;
    this.width = width;
    this.height = height;

    this.cameraData = new Float32Array(16);
    this.settingsData = new Uint32Array(6);
  }

  async initialize(
    bvhNodesBuffer: GPUBuffer,
    voxelBuffer: GPUBuffer,
    bvhNodeCount: number
  ): Promise<void> {
    this.bvhNodesBuffer = bvhNodesBuffer;
    this.voxelBuffer = voxelBuffer;
    this.bvhNodeCount = bvhNodeCount;

    this.createTextures();
    this.createBuffers();
    this.createPipelines();
    this.createBindGroups();
    this.isInitialized = true;
  }

  private createTextures(): void {
    const device = this.context.device;

    this.raytraceTexture = device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });

    this.bvhRenderTexture = device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'bgra8unorm',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING,
    });

    this.bvhDepthTexture = device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private createBuffers(): void {
    const device = this.context.device;

    this.cameraUniformBuffer = this.context.createUniformBuffer(16 * 4);
    this.bvhCameraUniformBuffer = this.context.createUniformBuffer(20 * 4);
    this.settingsUniformBuffer = this.context.createUniformBuffer(5 * 4);
    this.bvhLevelUniformBuffer = this.context.createUniformBuffer(4);
    this.showBVHUniformBuffer = this.context.createUniformBuffer(4);

    this.traversalCountBuffer = device.createBuffer({
      size: this.width * this.height * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.readbackBuffer = device.createBuffer({
      size: this.width * this.height * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  private createPipelines(): void {
    const device = this.context.device;

    const raytraceShader = this.context.createShaderModule(RAYTRACE_SHADER);
    const bvhVisualizeShader = this.context.createShaderModule(BVH_VISUALIZE_SHADER);
    const compositeShader = this.context.createShaderModule(COMPOSITE_SHADER);

    const raytraceBindGroupLayout = this.context.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ]);

    this.raytracePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [raytraceBindGroupLayout] }),
      compute: { module: raytraceShader, entryPoint: 'main' },
    });

    const bvhVisualizeBindGroupLayout = this.context.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ]);

    this.bvhVisualizePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bvhVisualizeBindGroupLayout] }),
      vertex: { module: bvhVisualizeShader, entryPoint: 'vs_main' },
      fragment: {
        module: bvhVisualizeShader,
        entryPoint: 'fs_main',
        targets: [{ format: 'bgra8unorm', blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        }}],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth24plus',
        depthCompare: 'less-equal',
        depthWriteEnabled: true,
      },
    });

    const compositeBindGroupLayout = this.context.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ]);

    this.compositePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [compositeBindGroupLayout] }),
      vertex: { module: compositeShader, entryPoint: 'vs_main' },
      fragment: {
        module: compositeShader,
        entryPoint: 'fs_main',
        targets: [{ format: this.context.format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  private createBindGroups(): void {
    const device = this.context.device;

    const raytraceBindGroupLayout = this.context.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ]);

    this.raytraceBindGroup = device.createBindGroup({
      layout: raytraceBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer } },
        { binding: 1, resource: { buffer: this.bvhNodesBuffer } },
        { binding: 2, resource: { buffer: this.voxelBuffer } },
        { binding: 3, resource: this.raytraceTexture.createView() },
        { binding: 4, resource: { buffer: this.settingsUniformBuffer } },
        { binding: 5, resource: { buffer: this.traversalCountBuffer } },
      ],
    });

    const bvhVisualizeBindGroupLayout = this.context.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ]);

    this.bvhVisualizeBindGroup = device.createBindGroup({
      layout: bvhVisualizeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.bvhCameraUniformBuffer } },
        { binding: 1, resource: { buffer: this.bvhNodesBuffer } },
        { binding: 2, resource: { buffer: this.bvhLevelUniformBuffer } },
      ],
    });

    const compositeBindGroupLayout = this.context.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ]);

    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.compositeBindGroup = device.createBindGroup({
      layout: compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: this.raytraceTexture.createView() },
        { binding: 1, resource: this.bvhRenderTexture.createView() },
        { binding: 2, resource: sampler },
        { binding: 3, resource: { buffer: this.showBVHUniformBuffer } },
      ],
    });
  }

  updateCamera(camera: Camera): void {
    if (!this.isInitialized || !this.cameraUniformBuffer) return;
    const { position, target, up, fov } = camera;

    const forward = this.normalize({
      x: target.x - position.x,
      y: target.y - position.y,
      z: target.z - position.z,
    });

    const right = this.normalize(this.cross(up, forward));
    const cameraUp = this.cross(forward, right);

    this.cameraData[0] = position.x;
    this.cameraData[1] = position.y;
    this.cameraData[2] = position.z;
    this.cameraData[3] = forward.x;
    this.cameraData[4] = forward.y;
    this.cameraData[5] = forward.z;
    this.cameraData[6] = right.x;
    this.cameraData[7] = right.y;
    this.cameraData[8] = right.z;
    this.cameraData[9] = cameraUp.x;
    this.cameraData[10] = cameraUp.y;
    this.cameraData[11] = cameraUp.z;
    this.cameraData[12] = (fov * Math.PI) / 180;
    this.cameraData[13] = this.width / this.height;

    this.context.writeBuffer(this.cameraUniformBuffer, this.cameraData);

    const viewProj = this.computeViewProjectionMatrix(position, target, up);
    const bvhCameraData = new Float32Array(20);
    bvhCameraData.set([position.x, position.y, position.z, 0], 0);
    bvhCameraData.set(viewProj, 4);
    this.context.writeBuffer(this.bvhCameraUniformBuffer, bvhCameraData);
  }

  private normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  private cross(a: Vec3, b: Vec3): Vec3 {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  private computeViewProjectionMatrix(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
    const zAxis = this.normalize({ x: eye.x - target.x, y: eye.y - target.y, z: eye.z - target.z });
    const xAxis = this.normalize(this.cross(up, zAxis));
    const yAxis = this.cross(zAxis, xAxis);

    const view = new Float32Array(16);
    view[0] = xAxis.x;
    view[1] = yAxis.x;
    view[2] = zAxis.x;
    view[3] = 0;
    view[4] = xAxis.y;
    view[5] = yAxis.y;
    view[6] = zAxis.y;
    view[7] = 0;
    view[8] = xAxis.z;
    view[9] = yAxis.z;
    view[10] = zAxis.z;
    view[11] = 0;
    view[12] = -(xAxis.x * eye.x + xAxis.y * eye.y + xAxis.z * eye.z);
    view[13] = -(yAxis.x * eye.x + yAxis.y * eye.y + yAxis.z * eye.z);
    view[14] = -(zAxis.x * eye.x + zAxis.y * eye.y + zAxis.z * eye.z);
    view[15] = 1;

    const aspect = this.width / this.height;
    const fov = Math.PI / 3;
    const near = 0.1;
    const far = 1000;
    const f = 1 / Math.tan(fov / 2);

    const proj = new Float32Array(16);
    proj[0] = f / aspect;
    proj[1] = 0;
    proj[2] = 0;
    proj[3] = 0;
    proj[4] = 0;
    proj[5] = f;
    proj[6] = 0;
    proj[7] = 0;
    proj[8] = 0;
    proj[9] = 0;
    proj[10] = (far + near) / (near - far);
    proj[11] = -1;
    proj[12] = 0;
    proj[13] = 0;
    proj[14] = (2 * far * near) / (near - far);
    proj[15] = 0;

    const viewProj = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += proj[i * 4 + k] * view[k * 4 + j];
        }
        viewProj[i * 4 + j] = sum;
      }
    }

    return viewProj;
  }

  updateSettings(settings: RenderSettings): void {
    if (!this.isInitialized || !this.settingsUniformBuffer) return;
    this.settingsData[0] = settings.raysPerPixel;
    this.settingsData[1] = settings.maxBounces;
    this.settingsData[2] = this.frame;
    this.settingsData[3] = settings.showBVH ? 1 : 0;
    this.settingsData[4] = settings.bvhLevel;
    this.settingsData[5] = this.clearTraversalNextFrame ? 1 : 0;
    this.context.writeBuffer(this.settingsUniformBuffer, this.settingsData);

    this.context.writeBuffer(this.bvhLevelUniformBuffer, new Uint32Array([settings.bvhLevel]));
    this.context.writeBuffer(this.showBVHUniformBuffer, new Float32Array([settings.showBVH ? 1 : 0]));
  }

  updateBVHBuffers(bvhNodesBuffer: GPUBuffer, voxelBuffer: GPUBuffer, bvhNodeCount: number): void {
    this.bvhNodesBuffer = bvhNodesBuffer;
    this.voxelBuffer = voxelBuffer;
    this.bvhNodeCount = bvhNodeCount;
    this.createBindGroups();
  }

  render(): PerformanceMetrics {
    const now = performance.now();
    const frameTime = this.lastFrameTime > 0 ? now - this.lastFrameTime : 16;
    this.lastFrameTime = now;

    this.frameTimes.push(frameTime);
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const fps = 1000 / avgFrameTime;

    this.settingsData[2] = this.frame++;
    this.settingsData[5] = this.clearTraversalNextFrame ? 1 : 0;
    this.context.writeBuffer(this.settingsUniformBuffer, this.settingsData);
    this.clearTraversalNextFrame = false;

    const device = this.context.device;
    const commandEncoder = device.createCommandEncoder();

    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.raytracePipeline);
    computePass.setBindGroup(0, this.raytraceBindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.width / 8),
      Math.ceil(this.height / 8)
    );
    computePass.end();

    const bvhRenderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.bvhRenderTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.bvhDepthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    bvhRenderPass.setPipeline(this.bvhVisualizePipeline);
    bvhRenderPass.setBindGroup(0, this.bvhVisualizeBindGroup);
    bvhRenderPass.draw(this.bvhNodeCount * 24);
    bvhRenderPass.end();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    renderPass.setPipeline(this.compositePipeline);
    renderPass.setBindGroup(0, this.compositeBindGroup);
    renderPass.draw(6);
    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);

    return {
      bvhBuildTime: 0,
      avgTraversalCount: 0,
      fps,
      frameTime: avgFrameTime,
    };
  }

  async getAverageTraversalCount(): Promise<number> {
    const device = this.context.device;

    const tempReadback = device.createBuffer({
      size: this.readbackBuffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      this.traversalCountBuffer,
      0,
      tempReadback,
      0,
      tempReadback.size
    );
    device.queue.submit([encoder.finish()]);

    await tempReadback.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(tempReadback.getMappedRange());

    let sum = 0;
    let count = 0;
    const pixelCount = this.width * this.height;

    for (let i = 0; i < pixelCount; i++) {
      const val = data[i];
      if (val > 0) {
        sum += val;
        count++;
      }
    }

    tempReadback.unmap();
    tempReadback.destroy();

    this.clearTraversalNextFrame = true;

    return count > 0 ? sum / count : 0;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    this.raytraceTexture?.destroy();
    this.bvhRenderTexture?.destroy();
    this.bvhDepthTexture?.destroy();
    this.traversalCountBuffer?.destroy();
    this.readbackBuffer?.destroy();

    this.createTextures();
    this.createBuffers();
    this.createBindGroups();
  }

  destroy(): void {
    this.raytraceTexture?.destroy();
    this.bvhRenderTexture?.destroy();
    this.bvhDepthTexture?.destroy();
    this.cameraUniformBuffer?.destroy();
    this.settingsUniformBuffer?.destroy();
    this.bvhLevelUniformBuffer?.destroy();
    this.showBVHUniformBuffer?.destroy();
    this.bvhCameraUniformBuffer?.destroy();
    this.traversalCountBuffer?.destroy();
    this.readbackBuffer?.destroy();
  }
}
