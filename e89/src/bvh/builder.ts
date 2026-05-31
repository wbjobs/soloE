import { WebGPUContext } from '../webgpu/context';
import { VoxelData, BVHNode } from '../types';
import { BVH_BUILD_OPTIMIZED_SHADER } from '../shaders/bvhBuild.wgsl';

interface VoxelInfo {
  x: number;
  y: number;
  z: number;
  value: number;
}

type BuildPhase = 'idle' | 'morton' | 'build' | 'refit' | 'complete';

export interface BuildProgress {
  phase: BuildPhase;
  progress: number;
  total: number;
}

export class BVHBuilder {
  private context: WebGPUContext;
  private voxelBuffer!: GPUBuffer;
  private bvhNodesBuffer!: GPUBuffer;
  private sortItemsBuffer!: GPUBuffer;
  private parentsBuffer!: GPUBuffer;
  private uniformsBuffer!: GPUBuffer;
  private voxelInfos: VoxelInfo[] = [];
  private nodeCount: number = 0;
  private buildTime: number = 0;

  private shaderModule!: GPUShaderModule;
  private bindGroup!: GPUBindGroup;
  private generatePipeline!: GPUComputePipeline;
  private buildPipeline!: GPUComputePipeline;
  private refitPipeline!: GPUComputePipeline;

  private currentPhase: BuildPhase = 'idle';
  private phaseProgress: number = 0;
  private phaseTotal: number = 0;
  private batchSize: number = 10000;
  private onProgressCallback?: (progress: BuildProgress) => void;

  constructor(context: WebGPUContext) {
    this.context = context;
  }

  setOnProgress(callback: (progress: BuildProgress) => void): void {
    this.onProgressCallback = callback;
  }

  async build(
    voxelData: VoxelData,
    incremental: boolean = true
  ): Promise<{ buffer: GPUBuffer; nodeCount: number; buildTime: number }> {
    const startTime = performance.now();
    this.currentPhase = 'idle';

    this.extractVoxels(voxelData);
    if (this.voxelInfos.length === 0) {
      throw new Error('没有非空体素');
    }

    this.createBuffers();
    this.createPipelines();

    if (incremental) {
      await this.buildIncremental();
    } else {
      await this.buildGPU();
    }

    this.buildTime = performance.now() - startTime;
    this.currentPhase = 'complete';

    return {
      buffer: this.bvhNodesBuffer,
      nodeCount: this.nodeCount,
      buildTime: this.buildTime,
    };
  }

  private extractVoxels(voxelData: VoxelData): void {
    this.voxelInfos = [];
    const { width, height, depth, data } = voxelData;

    for (let z = 0; z < depth; z++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = z * width * height + y * width + x;
          if (data[idx] > 0) {
            this.voxelInfos.push({ x, y, z, value: data[idx] });
          }
        }
      }
    }

    this.voxelInfos.sort((a, b) => {
      const mortonA = this.morton3D(a.x, a.y, a.z);
      const mortonB = this.morton3D(b.x, b.y, b.z);
      return mortonA - mortonB;
    });

    this.nodeCount = this.voxelInfos.length * 2 - 1;
  }

  private expandBits(v: number): number {
    v = v & 0x3ff;
    v = (v | (v << 16)) & 0x030000ff;
    v = (v | (v << 8)) & 0x0300f00f;
    v = (v | (v << 4)) & 0x030c30c3;
    v = (v | (v << 2)) & 0x09249249;
    return v;
  }

  private morton3D(x: number, y: number, z: number): number {
    return (this.expandBits(z) << 2) | (this.expandBits(y) << 1) | this.expandBits(x);
  }

  private createBuffers(): void {
    const voxelData = new Uint32Array(this.voxelInfos.length * 4);
    for (let i = 0; i < this.voxelInfos.length; i++) {
      const v = this.voxelInfos[i];
      voxelData[i * 4] = v.x;
      voxelData[i * 4 + 1] = v.y;
      voxelData[i * 4 + 2] = v.z;
      voxelData[i * 4 + 3] = v.value;
    }

    this.voxelBuffer = this.context.createBuffer(
      voxelData,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    const bvhNodeSize = 8 * 4;
    this.bvhNodesBuffer = this.context.createStorageBuffer(this.nodeCount * bvhNodeSize);

    const sortItemSize = 2 * 4;
    this.sortItemsBuffer = this.context.createStorageBuffer(this.voxelInfos.length * sortItemSize);

    this.parentsBuffer = this.context.createStorageBuffer(this.nodeCount * 4);

    this.uniformsBuffer = this.context.createUniformBuffer(4 * 4);
  }

  private createPipelines(): void {
    const device = this.context.device;

    this.shaderModule = this.context.createShaderModule(BVH_BUILD_OPTIMIZED_SHADER);

    const bindGroupLayout = this.context.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]);

    this.bindGroup = this.context.createBindGroup(bindGroupLayout, [
      { binding: 0, resource: { buffer: this.voxelBuffer } },
      { binding: 1, resource: { buffer: this.bvhNodesBuffer } },
      { binding: 2, resource: { buffer: this.sortItemsBuffer } },
      { binding: 3, resource: { buffer: this.parentsBuffer } },
      { binding: 4, resource: { buffer: this.uniformsBuffer } },
    ]);

    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    this.generatePipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: this.shaderModule, entryPoint: 'generateMortonCodes' },
    });

    this.buildPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: this.shaderModule, entryPoint: 'buildBVHNodes' },
    });

    this.refitPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: this.shaderModule, entryPoint: 'refitBVH' },
    });
  }

  private async buildIncremental(): Promise<void> {
    const voxelCount = this.voxelInfos.length;
    const internalNodes = voxelCount - 1;

    this.currentPhase = 'morton';
    this.phaseTotal = voxelCount;
    this.phaseProgress = 0;
    this.reportProgress();

    for (let start = 0; start < voxelCount; start += this.batchSize) {
      const end = Math.min(start + this.batchSize, voxelCount);
      const batchCount = end - start;

      this.updateUniforms(voxelCount, start, end, 0);

      const commandEncoder = this.context.device.createCommandEncoder();
      const pass = commandEncoder.beginComputePass();
      pass.setPipeline(this.generatePipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.dispatchWorkgroups(Math.ceil(batchCount / 256));
      pass.end();

      this.context.device.queue.submit([commandEncoder.finish()]);
      await this.context.device.queue.onSubmittedWorkDone();

      this.phaseProgress = end;
      this.reportProgress();

      await this.sleep(1);
    }

    this.currentPhase = 'build';
    this.phaseTotal = internalNodes;
    this.phaseProgress = 0;
    this.reportProgress();

    for (let start = 0; start < internalNodes; start += this.batchSize) {
      const end = Math.min(start + this.batchSize, internalNodes);
      const batchCount = end - start;

      this.updateUniforms(voxelCount, start, end, 1);

      const commandEncoder = this.context.device.createCommandEncoder();
      const pass = commandEncoder.beginComputePass();
      pass.setPipeline(this.buildPipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.dispatchWorkgroups(Math.ceil(batchCount / 128));
      pass.end();

      this.context.device.queue.submit([commandEncoder.finish()]);
      await this.context.device.queue.onSubmittedWorkDone();

      this.phaseProgress = end;
      this.reportProgress();

      await this.sleep(1);
    }

    this.currentPhase = 'refit';
    this.phaseTotal = internalNodes;
    this.phaseProgress = 0;
    this.reportProgress();

    for (let start = 0; start < internalNodes; start += this.batchSize) {
      const end = Math.min(start + this.batchSize, internalNodes);
      const batchCount = end - start;

      this.updateUniforms(voxelCount, start, end, 2);

      const commandEncoder = this.context.device.createCommandEncoder();
      const pass = commandEncoder.beginComputePass();
      pass.setPipeline(this.refitPipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.dispatchWorkgroups(Math.ceil(batchCount / 64));
      pass.end();

      this.context.device.queue.submit([commandEncoder.finish()]);
      await this.context.device.queue.onSubmittedWorkDone();

      this.phaseProgress = end;
      this.reportProgress();

      await this.sleep(1);
    }
  }

  private updateUniforms(voxelCount: number, batchStart: number, batchEnd: number, phase: number): void {
    const uniforms = new Uint32Array(4);
    uniforms[0] = voxelCount;
    uniforms[1] = batchStart;
    uniforms[2] = batchEnd;
    uniforms[3] = phase;
    this.context.writeBuffer(this.uniformsBuffer, uniforms);
  }

  private reportProgress(): void {
    if (this.onProgressCallback) {
      this.onProgressCallback({
        phase: this.currentPhase,
        progress: this.phaseProgress,
        total: this.phaseTotal,
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async buildGPU(): Promise<void> {
    const device = this.context.device;
    const voxelCount = this.voxelInfos.length;
    const internalNodes = voxelCount - 1;

    this.updateUniforms(voxelCount, 0, voxelCount, 0);

    const commandEncoder = device.createCommandEncoder();

    let pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.generatePipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(voxelCount / 256));
    pass.end();

    this.updateUniforms(voxelCount, 0, internalNodes, 1);

    pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.buildPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(internalNodes / 128));
    pass.end();

    this.updateUniforms(voxelCount, 0, internalNodes, 2);

    pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.refitPipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(internalNodes / 64));
    pass.end();

    device.queue.submit([commandEncoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }

  getVoxelBuffer(): GPUBuffer {
    return this.voxelBuffer;
  }

  getVoxelCount(): number {
    return this.voxelInfos.length;
  }

  getBuildTime(): number {
    return this.buildTime;
  }

  async readbackBVHNodes(): Promise<BVHNode[]> {
    const device = this.context.device;
    const readBuffer = device.createBuffer({
      size: this.bvhNodesBuffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.bvhNodesBuffer, 0, readBuffer, 0, this.bvhNodesBuffer.size);
    device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readBuffer.getMappedRange());
    const nodes: BVHNode[] = [];

    for (let i = 0; i < this.nodeCount; i++) {
      const offset = i * 8;
      nodes.push({
        minX: data[offset],
        minY: data[offset + 1],
        minZ: data[offset + 2],
        leftChild: data[offset + 3],
        maxX: data[offset + 4],
        maxY: data[offset + 5],
        maxZ: data[offset + 6],
        rightChild: data[offset + 7],
      });
    }

    readBuffer.unmap();
    return nodes;
  }

  destroy(): void {
    this.voxelBuffer?.destroy();
    this.bvhNodesBuffer?.destroy();
    this.sortItemsBuffer?.destroy();
    this.parentsBuffer?.destroy();
    this.uniformsBuffer?.destroy();
  }
}
