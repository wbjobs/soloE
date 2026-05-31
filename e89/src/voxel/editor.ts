import { WebGPUContext } from '../webgpu/context';
import { VoxelData, Vec3 } from '../types';
import { VOXEL_PICK_SHADER } from '../shaders/voxelPick.wgsl';

export interface PickResult {
  hit: boolean;
  voxelX: number;
  voxelY: number;
  voxelZ: number;
  voxelIndex: number;
  distance: number;
  normal: Vec3;
}

export interface VoxelEditOperation {
  type: 'add' | 'remove';
  x: number;
  y: number;
  z: number;
  value: number;
}

interface VoxelInfo {
  x: number;
  y: number;
  z: number;
  value: number;
}

export class VoxelEditor {
  private context: WebGPUContext;
  private voxelData: VoxelData;
  private voxelInfos: VoxelInfo[] = [];
  private voxelIndexMap: Map<string, number> = new Map();

  private bvhNodesBuffer!: GPUBuffer;
  private voxelBuffer!: GPUBuffer;
  private bvhNodeCount: number = 0;
  private parents: Int32Array = new Int32Array();
  private bvhNodes: Float32Array = new Float32Array();

  private pickPipeline!: GPUComputePipeline;
  private pickBindGroup!: GPUBindGroup;
  private pickResultBuffer!: GPUBuffer;
  private pickReadbackBuffer!: GPUBuffer;
  private pickUniformsBuffer!: GPUBuffer;
  private pickCameraBuffer!: GPUBuffer;

  private isInitialized: boolean = false;

  constructor(context: WebGPUContext, voxelData: VoxelData) {
    this.context = context;
    this.voxelData = voxelData;
    this.extractVoxels();
  }

  private extractVoxels(): void {
    this.voxelInfos = [];
    this.voxelIndexMap.clear();
    const { width, height, depth, data } = this.voxelData;

    for (let z = 0; z < depth; z++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = z * width * height + y * width + x;
          if (data[idx] > 0) {
            const voxelIdx = this.voxelInfos.length;
            this.voxelInfos.push({ x, y, z, value: data[idx] });
            this.voxelIndexMap.set(`${x},${y},${z}`, voxelIdx);
          }
        }
      }
    }
  }

  setBVHBuffers(
    bvhNodesBuffer: GPUBuffer,
    voxelBuffer: GPUBuffer,
    bvhNodeCount: number,
    parents: Int32Array,
    bvhNodes: Float32Array
  ): void {
    this.bvhNodesBuffer = bvhNodesBuffer;
    this.voxelBuffer = voxelBuffer;
    this.bvhNodeCount = bvhNodeCount;
    this.parents = parents;
    this.bvhNodes = bvhNodes;
  }

  async initializePicking(): Promise<void> {
    if (this.isInitialized) return;

    const device = this.context.device;
    const shaderModule = this.context.createShaderModule(VOXEL_PICK_SHADER);

    this.pickResultBuffer = device.createBuffer({
      size: 9 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.pickReadbackBuffer = device.createBuffer({
      size: 9 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    this.pickUniformsBuffer = this.context.createUniformBuffer(4 * 4);
    this.pickCameraBuffer = this.context.createUniformBuffer(16 * 4);

    const bindGroupLayout = this.context.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]);

    this.pickBindGroup = this.context.createBindGroup(bindGroupLayout, [
      { binding: 0, resource: { buffer: this.pickCameraBuffer } },
      { binding: 1, resource: { buffer: this.bvhNodesBuffer } },
      { binding: 2, resource: { buffer: this.voxelBuffer } },
      { binding: 3, resource: { buffer: this.pickResultBuffer } },
      { binding: 4, resource: { buffer: this.pickUniformsBuffer } },
    ]);

    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    this.pickPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    this.isInitialized = true;
  }

  async pickVoxel(
    screenX: number,
    screenY: number,
    screenWidth: number,
    screenHeight: number,
    cameraData: Float32Array
  ): Promise<PickResult> {
    if (!this.isInitialized) {
      await this.initializePicking();
    }

    const device = this.context.device;

    const pickUniforms = new ArrayBuffer(4 * 4);
    const pickUniformsF32 = new Float32Array(pickUniforms);
    const pickUniformsU32 = new Uint32Array(pickUniforms);
    pickUniformsF32[0] = screenX;
    pickUniformsF32[1] = screenY;
    pickUniformsU32[2] = screenWidth;
    pickUniformsU32[3] = screenHeight;

    this.context.writeBuffer(this.pickUniformsBuffer, pickUniforms);
    this.context.writeBuffer(this.pickCameraBuffer, cameraData);

    const clearData = new Uint32Array(9);
    clearData[0] = 0;
    clearData[4] = 0xffffffff;
    this.context.writeBuffer(this.pickResultBuffer, clearData);

    const commandEncoder = device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pickPipeline);
    pass.setBindGroup(0, this.pickBindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    device.queue.submit([commandEncoder.finish()]);

    await device.queue.onSubmittedWorkDone();

    const readEncoder = device.createCommandEncoder();
    readEncoder.copyBufferToBuffer(
      this.pickResultBuffer,
      0,
      this.pickReadbackBuffer,
      0,
      9 * 4
    );
    device.queue.submit([readEncoder.finish()]);

    await this.pickReadbackBuffer.mapAsync(GPUMapMode.READ);
    const dataU32 = new Uint32Array(this.pickReadbackBuffer.getMappedRange());
    const dataF32 = new Float32Array(this.pickReadbackBuffer.getMappedRange());

    const hit = dataU32[0] === 1;
    const result: PickResult = {
      hit,
      voxelX: dataU32[1],
      voxelY: dataU32[2],
      voxelZ: dataU32[3],
      voxelIndex: dataU32[4],
      distance: dataF32[5],
      normal: { x: dataF32[6], y: dataF32[7], z: dataF32[8] },
    };

    this.pickReadbackBuffer.unmap();
    return result;
  }

  async editVoxel(operation: VoxelEditOperation): Promise<{ success: boolean; updateTime: number }> {
    const startTime = performance.now();

    if (operation.type === 'add') {
      await this.addVoxel(operation.x, operation.y, operation.z, operation.value);
    } else {
      await this.removeVoxel(operation.x, operation.y, operation.z);
    }

    const updateTime = performance.now() - startTime;
    return { success: true, updateTime };
  }

  private async addVoxel(x: number, y: number, z: number, value: number): Promise<void> {
    const key = `${x},${y},${z}`;
    if (this.voxelIndexMap.has(key)) {
      return;
    }

    const { width, height, depth } = this.voxelData;
    if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= depth) {
      return;
    }

    const voxelIdx = this.voxelInfos.length;
    this.voxelInfos.push({ x, y, z, value });
    this.voxelIndexMap.set(key, voxelIdx);

    const dataIdx = z * width * height + y * width + x;
    this.voxelData.data[dataIdx] = value;

    const newLeafNodeIdx = this.bvhNodeCount;
    const oldRootIdx = this.bvhNodeCount - 1;

    const nodeOffset = newLeafNodeIdx * 8;
    this.bvhNodes[nodeOffset] = x;
    this.bvhNodes[nodeOffset + 1] = y;
    this.bvhNodes[nodeOffset + 2] = z;
    this.bvhNodes[nodeOffset + 3] = -1;
    this.bvhNodes[nodeOffset + 4] = x + 1;
    this.bvhNodes[nodeOffset + 5] = y + 1;
    this.bvhNodes[nodeOffset + 6] = z + 1;
    this.bvhNodes[nodeOffset + 7] = -1;

    const newInternalIdx = newLeafNodeIdx + 1;
    const internalOffset = newInternalIdx * 8;

    const oldRootOffset = oldRootIdx * 8;
    const oldMinX = this.bvhNodes[oldRootOffset];
    const oldMinY = this.bvhNodes[oldRootOffset + 1];
    const oldMinZ = this.bvhNodes[oldRootOffset + 2];
    const oldMaxX = this.bvhNodes[oldRootOffset + 4];
    const oldMaxY = this.bvhNodes[oldRootOffset + 5];
    const oldMaxZ = this.bvhNodes[oldRootOffset + 6];

    this.bvhNodes[internalOffset] = Math.min(oldMinX, x);
    this.bvhNodes[internalOffset + 1] = Math.min(oldMinY, y);
    this.bvhNodes[internalOffset + 2] = Math.min(oldMinZ, z);
    this.bvhNodes[internalOffset + 3] = oldRootIdx;
    this.bvhNodes[internalOffset + 4] = Math.max(oldMaxX, x + 1);
    this.bvhNodes[internalOffset + 5] = Math.max(oldMaxY, y + 1);
    this.bvhNodes[internalOffset + 6] = Math.max(oldMaxZ, z + 1);
    this.bvhNodes[internalOffset + 7] = newLeafNodeIdx;

    const newParents = new Int32Array(this.bvhNodeCount + 2);
    newParents.set(this.parents);
    newParents[oldRootIdx] = newInternalIdx;
    newParents[newLeafNodeIdx] = newInternalIdx;
    newParents[newInternalIdx] = -1;
    this.parents = newParents;

    this.bvhNodeCount += 2;

    this.updateGPUBuffers();
  }

  private async removeVoxel(x: number, y: number, z: number): Promise<void> {
    const key = `${x},${y},${z}`;
    const voxelIdx = this.voxelIndexMap.get(key);
    if (voxelIdx === undefined) {
      return;
    }

    const { width, height } = this.voxelData;
    const dataIdx = z * width * height + y * width + x;
    this.voxelData.data[dataIdx] = 0;

    const lastVoxelIdx = this.voxelInfos.length - 1;
    if (voxelIdx !== lastVoxelIdx) {
      const lastVoxel = this.voxelInfos[lastVoxelIdx];
      this.voxelInfos[voxelIdx] = lastVoxel;
      this.voxelIndexMap.set(`${lastVoxel.x},${lastVoxel.y},${lastVoxel.z}`, voxelIdx);

      const nodeOffset = voxelIdx * 8;
      const lastNodeOffset = lastVoxelIdx * 8;
      this.bvhNodes.set(
        this.bvhNodes.subarray(lastNodeOffset, lastNodeOffset + 8),
        nodeOffset
      );

      const parent = this.parents[lastVoxelIdx];
      this.parents[voxelIdx] = parent;

      if (parent !== -1) {
        const parentOffset = parent * 8;
        if (this.bvhNodes[parentOffset + 3] === lastVoxelIdx) {
          this.bvhNodes[parentOffset + 3] = voxelIdx;
        }
        if (this.bvhNodes[parentOffset + 7] === lastVoxelIdx) {
          this.bvhNodes[parentOffset + 7] = voxelIdx;
        }
      }
    }

    this.voxelInfos.pop();
    this.voxelIndexMap.delete(key);

    if (voxelIdx === lastVoxelIdx && lastVoxelIdx < this.bvhNodeCount - 2) {
      const siblingIdx = lastVoxelIdx % 2 === 0 ? lastVoxelIdx + 1 : lastVoxelIdx - 1;
      const parentIdx = this.parents[lastVoxelIdx];

      if (parentIdx !== -1 && siblingIdx >= 0) {
        const grandparentIdx = this.parents[parentIdx];
        if (grandparentIdx !== -1) {
          const grandparentOffset = grandparentIdx * 8;
          if (this.bvhNodes[grandparentOffset + 3] === parentIdx) {
            this.bvhNodes[grandparentOffset + 3] = siblingIdx;
          }
          if (this.bvhNodes[grandparentOffset + 7] === parentIdx) {
            this.bvhNodes[grandparentOffset + 7] = siblingIdx;
          }
          this.parents[siblingIdx] = grandparentIdx;
        }

        if (parentIdx < this.bvhNodeCount - 2) {
          const lastInternalIdx = this.bvhNodeCount - 2;
          const lastLeafIdx = this.bvhNodeCount - 1;

          if (parentIdx !== lastInternalIdx && parentIdx !== lastLeafIdx) {
            const lastInternalOffset = lastInternalIdx * 8;
            this.bvhNodes.set(
              this.bvhNodes.subarray(lastInternalOffset, lastInternalOffset + 8),
              parentIdx * 8
            );
            this.parents[parentIdx] = this.parents[lastInternalIdx];

            const childLeft = this.bvhNodes[parentIdx * 8 + 3];
            const childRight = this.bvhNodes[parentIdx * 8 + 7];
            if (childLeft !== -1) this.parents[childLeft] = parentIdx;
            if (childRight !== -1) this.parents[childRight] = parentIdx;

            const lastLeafOffset = lastLeafIdx * 8;
            const siblingInLast = lastLeafIdx === siblingIdx;
            if (siblingInLast) {
              const targetIdx = lastInternalIdx;
              this.bvhNodes.set(
                this.bvhNodes.subarray(lastLeafOffset, lastLeafOffset + 8),
                targetIdx * 8
              );
              this.parents[targetIdx] = this.parents[lastLeafIdx];
              const tParent = this.parents[targetIdx];
              if (tParent !== -1) {
                const tParentOffset = tParent * 8;
                if (this.bvhNodes[tParentOffset + 3] === lastLeafIdx) {
                  this.bvhNodes[tParentOffset + 3] = targetIdx;
                }
                if (this.bvhNodes[tParentOffset + 7] === lastLeafIdx) {
                  this.bvhNodes[tParentOffset + 7] = targetIdx;
                }
              }
            }
          }
          this.bvhNodeCount -= 2;
        }
      }
    }

    this.propagateAABBUp(voxelIdx);
    this.updateGPUBuffers();
  }

  private propagateAABBUp(nodeIdx: number): void {
    let current = this.parents[nodeIdx];
    while (current !== -1) {
      const offset = current * 8;
      const leftChild = this.bvhNodes[offset + 3];
      const rightChild = this.bvhNodes[offset + 7];

      if (leftChild !== -1 && rightChild !== -1) {
        const leftOffset = leftChild * 8;
        const rightOffset = rightChild * 8;

        this.bvhNodes[offset] = Math.min(this.bvhNodes[leftOffset], this.bvhNodes[rightOffset]);
        this.bvhNodes[offset + 1] = Math.min(this.bvhNodes[leftOffset + 1], this.bvhNodes[rightOffset + 1]);
        this.bvhNodes[offset + 2] = Math.min(this.bvhNodes[leftOffset + 2], this.bvhNodes[rightOffset + 2]);
        this.bvhNodes[offset + 4] = Math.max(this.bvhNodes[leftOffset + 4], this.bvhNodes[rightOffset + 4]);
        this.bvhNodes[offset + 5] = Math.max(this.bvhNodes[leftOffset + 5], this.bvhNodes[rightOffset + 5]);
        this.bvhNodes[offset + 6] = Math.max(this.bvhNodes[leftOffset + 6], this.bvhNodes[rightOffset + 6]);
      }

      current = this.parents[current];
    }
  }

  private updateGPUBuffers(): void {
    const device = this.context.device;

    const newVoxelData = new Uint32Array(this.voxelInfos.length * 4);
    for (let i = 0; i < this.voxelInfos.length; i++) {
      const v = this.voxelInfos[i];
      newVoxelData[i * 4] = v.x;
      newVoxelData[i * 4 + 1] = v.y;
      newVoxelData[i * 4 + 2] = v.z;
      newVoxelData[i * 4 + 3] = v.value;
    }

    const newVoxelBuffer = device.createBuffer({
      size: (newVoxelData.byteLength + 3) & ~3,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(newVoxelBuffer.getMappedRange()).set(newVoxelData);
    newVoxelBuffer.unmap();

    const oldVoxelBuffer = this.voxelBuffer;
    this.voxelBuffer = newVoxelBuffer;
    setTimeout(() => oldVoxelBuffer?.destroy(), 100);

    const bvhNodeSize = 8 * 4;
    const newBvhBuffer = device.createBuffer({
      size: this.bvhNodeCount * bvhNodeSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(newBvhBuffer, 0, this.bvhNodes.buffer, 0, this.bvhNodeCount * bvhNodeSize);

    const oldBvhBuffer = this.bvhNodesBuffer;
    this.bvhNodesBuffer = newBvhBuffer;
    setTimeout(() => oldBvhBuffer?.destroy(), 100);

    if (this.isInitialized) {
      this.recreatePickBindGroup();
    }
  }

  private recreatePickBindGroup(): void {
    const device = this.context.device;

    const bindGroupLayout = this.context.createBindGroupLayout([
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]);

    this.pickBindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.pickCameraBuffer } },
        { binding: 1, resource: { buffer: this.bvhNodesBuffer } },
        { binding: 2, resource: { buffer: this.voxelBuffer } },
        { binding: 3, resource: { buffer: this.pickResultBuffer } },
        { binding: 4, resource: { buffer: this.pickUniformsBuffer } },
      ],
    });
  }

  getBVHBuffers(): { bvhNodesBuffer: GPUBuffer; voxelBuffer: GPUBuffer; bvhNodeCount: number } {
    return {
      bvhNodesBuffer: this.bvhNodesBuffer,
      voxelBuffer: this.voxelBuffer,
      bvhNodeCount: this.bvhNodeCount,
    };
  }

  getVoxelCount(): number {
    return this.voxelInfos.length;
  }

  getVoxelData(): VoxelData {
    return this.voxelData;
  }

  destroy(): void {
    this.pickResultBuffer?.destroy();
    this.pickReadbackBuffer?.destroy();
    this.pickUniformsBuffer?.destroy();
    this.pickCameraBuffer?.destroy();
    this.isInitialized = false;
  }
}
