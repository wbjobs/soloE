import type { CSRMatrix } from '../types';

const GPUBufferUsage = {
  MAP_READ: 1,
  MAP_WRITE: 2,
  COPY_SRC: 4,
  COPY_DST: 8,
  INDEX: 16,
  VERTEX: 32,
  UNIFORM: 64,
  STORAGE: 128,
  INDIRECT: 256,
  QUERY_RESOLVE: 512,
};

const GPUMapMode = {
  READ: 1,
  WRITE: 2,
};

const GPUShaderStage = {
  VERTEX: 1,
  FRAGMENT: 2,
  COMPUTE: 4,
};

const MATRIX_MULTIPLY_WGSL = `
@group(0) @binding(0) var<storage, read> a_indptr: array<u32>;
@group(0) @binding(1) var<storage, read> a_indices: array<u32>;
@group(0) @binding(2) var<storage, read> a_data: array<f32>;
@group(0) @binding(3) var<storage, read> b_indptr: array<u32>;
@group(0) @binding(4) var<storage, read> b_indices: array<u32>;
@group(0) @binding(5) var<storage, read> b_data: array<f32>;
@group(0) @binding(6) var<storage, read_write> result: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let row = global_id.x;
  let n_rows = arrayLength(&a_indptr) - 1u;
  let n_cols = arrayLength(&a_indptr) - 1u;

  if (row >= n_rows) {
    return;
  }

  let a_start = a_indptr[row];
  let a_end = a_indptr[row + 1u];

  for (var i = a_start; i < a_end; i++) {
    let col_a = a_indices[i];
    let val_a = a_data[i];

    let b_start = b_indptr[col_a];
    let b_end = b_indptr[col_a + 1u];

    for (var j = b_start; j < b_end; j++) {
      let col_b = b_indices[j];
      let val_b = b_data[j];
      let idx = row * n_cols + col_b;
      result[idx] += val_a * val_b;
    }
  }
}
`;

const MATRIX_MULTIPLY_FP16_WGSL = `
enable f16;

@group(0) @binding(0) var<storage, read> a_indptr: array<u32>;
@group(0) @binding(1) var<storage, read> a_indices: array<u32>;
@group(0) @binding(2) var<storage, read> a_data: array<f16>;
@group(0) @binding(3) var<storage, read> b_indptr: array<u32>;
@group(0) @binding(4) var<storage, read> b_indices: array<u32>;
@group(0) @binding(5) var<storage, read> b_data: array<f16>;
@group(0) @binding(6) var<storage, read_write> result: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let row = global_id.x;
  let n_rows = arrayLength(&a_indptr) - 1u;
  let n_cols = arrayLength(&a_indptr) - 1u;

  if (row >= n_rows) {
    return;
  }

  let a_start = a_indptr[row];
  let a_end = a_indptr[row + 1u];

  for (var i = a_start; i < a_end; i++) {
    let col_a = a_indices[i];
    let val_a = f32(a_data[i]);

    let b_start = b_indptr[col_a];
    let b_end = b_indptr[col_a + 1u];

    for (var j = b_start; j < b_end; j++) {
      let col_b = b_indices[j];
      let val_b = f32(b_data[j]);
      let idx = row * n_cols + col_b;
      result[idx] += val_a * val_b;
    }
  }
}
`;

export class WebGPUMatrix {
  private device: any | null = null;
  private pipeline: any | null = null;
  private fp16Pipeline: any | null = null;

  async init(): Promise<boolean> {
    if (!(navigator as any).gpu) {
      console.warn('WebGPU not supported');
      return false;
    }

    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (!adapter) return false;

      this.device = await adapter.requestDevice();
      if (!this.device) return false;

      const bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
          { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        ]
      });

      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      });

      this.pipeline = this.device.createComputePipeline({
        layout: pipelineLayout,
        compute: {
          module: this.device.createShaderModule({ code: MATRIX_MULTIPLY_WGSL }),
          entryPoint: 'main',
        },
      });

      if (this.device.features.has('shader-f16')) {
        try {
          this.fp16Pipeline = this.device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
              module: this.device.createShaderModule({ code: MATRIX_MULTIPLY_FP16_WGSL }),
              entryPoint: 'main',
            },
          });
        } catch (e) {
          console.warn('FP16 pipeline creation failed:', e);
        }
      }

      return true;
    } catch (e) {
      console.error('WebGPU init failed:', e);
      return false;
    }
  }

  isSupported(): boolean {
    return this.device !== null;
  }

  supportsFP16(): boolean {
    return this.device?.features.has('shader-f16') ?? false;
  }

  async multiply(
    a: CSRMatrix,
    b: CSRMatrix,
    useFP16: boolean = false,
    onProgress?: (progress: number) => void
  ): Promise<CSRMatrix> {
    if (!this.device || !this.pipeline) {
      throw new Error('WebGPU not initialized');
    }

    onProgress?.(5);

    const pipeline = useFP16 && this.fp16Pipeline ? this.fp16Pipeline : this.pipeline;

    const n = a.rows;
    const k = a.cols;
    const m = b.cols;

    const resultSize = n * m;

    const aIndptrBuffer = this.device.createBuffer({
      size: a.indptr.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(aIndptrBuffer.getMappedRange()).set(a.indptr);
    aIndptrBuffer.unmap();

    const aIndicesBuffer = this.device.createBuffer({
      size: a.indices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(aIndicesBuffer.getMappedRange()).set(a.indices);
    aIndicesBuffer.unmap();

    const aDataBuffer = this.device.createBuffer({
      size: useFP16 ? a.data.length * 2 : a.data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    if (useFP16) {
      const fp16Data = new Uint16Array(aDataBuffer.getMappedRange());
      for (let i = 0; i < a.data.length; i++) {
        fp16Data[i] = this.float32ToFloat16(a.data[i]);
      }
    } else {
      new Float32Array(aDataBuffer.getMappedRange()).set(a.data);
    }
    aDataBuffer.unmap();

    const bIndptrBuffer = this.device.createBuffer({
      size: b.indptr.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(bIndptrBuffer.getMappedRange()).set(b.indptr);
    bIndptrBuffer.unmap();

    const bIndicesBuffer = this.device.createBuffer({
      size: b.indices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(bIndicesBuffer.getMappedRange()).set(b.indices);
    bIndicesBuffer.unmap();

    const bDataBuffer = this.device.createBuffer({
      size: useFP16 ? b.data.length * 2 : b.data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    if (useFP16) {
      const fp16Data = new Uint16Array(bDataBuffer.getMappedRange());
      for (let i = 0; i < b.data.length; i++) {
        fp16Data[i] = this.float32ToFloat16(b.data[i]);
      }
    } else {
      new Float32Array(bDataBuffer.getMappedRange()).set(b.data);
    }
    bDataBuffer.unmap();

    const resultBuffer = this.device.createBuffer({
      size: resultSize * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    onProgress?.(20);

    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: aIndptrBuffer } },
        { binding: 1, resource: { buffer: aIndicesBuffer } },
        { binding: 2, resource: { buffer: aDataBuffer } },
        { binding: 3, resource: { buffer: bIndptrBuffer } },
        { binding: 4, resource: { buffer: bIndicesBuffer } },
        { binding: 5, resource: { buffer: bDataBuffer } },
        { binding: 6, resource: { buffer: resultBuffer } },
      ],
    });

    onProgress?.(40);

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(n / 256));
    passEncoder.end();

    onProgress?.(60);

    const gpuReadBuffer = this.device.createBuffer({
      size: resultSize * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    commandEncoder.copyBufferToBuffer(resultBuffer, 0, gpuReadBuffer, 0, resultSize * 4);
    this.device.queue.submit([commandEncoder.finish()]);

    onProgress?.(80);

    await gpuReadBuffer.mapAsync(GPUMapMode.READ);
    const resultData = new Float32Array(gpuReadBuffer.getMappedRange());

    onProgress?.(90);

    const indptr = new Uint32Array(n + 1);
    const indices: number[] = [];
    const data: number[] = [];

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const val = resultData[i * m + j];
        if (Math.abs(val) > 1e-10) {
          indices.push(j);
          data.push(val);
          indptr[i + 1]++;
        }
      }
      indptr[i + 1] += indptr[i];

      if (i % Math.ceil(n / 10) === 0) {
        onProgress?.(90 + Math.floor((i / n) * 10));
      }
    }

    gpuReadBuffer.unmap();

    onProgress?.(100);

    return {
      rows: n,
      cols: m,
      indptr,
      indices: new Uint32Array(indices),
      data: new Float64Array(data),
      nnz: data.length,
    };
  }

  private float32ToFloat16(val: number): number {
    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);
    floatView[0] = val;

    const x = int32View[0];
    let bits = (x >> 16) & 0x8000;
    let mantissa = x & 0x7ffff;
    let exp = (x >> 23) & 0xff;

    if (exp > 142) {
      exp = 30;
      mantissa = 0x3ff;
    } else if (exp < 103) {
      exp = 0;
      mantissa = 0;
    } else {
      exp -= 112;
      mantissa = mantissa >> 13;
    }

    bits |= (exp << 10) | mantissa;
    return bits;
  }

  destroy() {
    this.device?.destroy();
    this.device = null;
  }
}

export const webGpuMatrix = new WebGPUMatrix();
