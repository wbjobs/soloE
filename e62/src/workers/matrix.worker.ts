import * as Comlink from 'comlink';
import { multiplyCSR, getMemoryUsage, convertToDense } from '../utils/matrix';
import { computeSVD, computeEigenvalues, type SVDResult, type EigenResult } from '../utils/linalg';
import { webGpuMatrix } from '../utils/webgpu';
import type { CSRMatrix, ComputeResult } from '../types';

let wasmModule: any = null;

async function loadWASM() {
  if (!wasmModule) {
    try {
      wasmModule = await import('../../wasm/pkg/sparse_matrix_wasm.js' as any);
      const threadCount = navigator.hardwareConcurrency || 4;
      wasmModule.init_wasm(threadCount);
    } catch (e) {
      console.warn('WASM module not built, using JS fallback.');
    }
  }
  return wasmModule;
}

let wasmMemory: WebAssembly.Memory | null = null;

function ensureMemorySize(requiredBytes: number) {
  if (!wasmMemory) return;
  const pageSize = 65536;
  const currentPages = wasmMemory.buffer.byteLength / pageSize;
  const requiredPages = Math.ceil(requiredBytes / pageSize);
  if (requiredPages > currentPages) {
    try { wasmMemory.grow(requiredPages - currentPages + 10); } catch (e) {}
  }
}

function copyTypedArrayToWASM<T extends Uint32Array | Float64Array>(arr: T, wasm: any): number {
  const bytesPerElement = arr.BYTES_PER_ELEMENT;
  const ptr = wasm.__wbindgen_malloc(arr.length * bytesPerElement);
  const heap = bytesPerElement === 4
    ? new Uint32Array(wasmMemory!.buffer)
    : new Float64Array(wasmMemory!.buffer);
  heap.set(arr, ptr / bytesPerElement);
  return ptr;
}

function readUint32ArrayFromWASM(ptr: number, length: number): Uint32Array {
  const heap = new Uint32Array(wasmMemory!.buffer);
  return new Uint32Array(heap.slice(ptr / 4, ptr / 4 + length));
}

function readFloat64ArrayFromWASM(ptr: number, length: number): Float64Array {
  const heap = new Float64Array(wasmMemory!.buffer);
  return new Float64Array(heap.slice(ptr / 8, ptr / 8 + length));
}

const workerApi = {
  async multiply(
    matrixA: CSRMatrix,
    matrixB: CSRMatrix,
    engine: 'js' | 'wasm' | 'webgpu',
    useFP16: boolean = false,
    onProgress?: (progress: number) => void
  ): Promise<ComputeResult> {
    const startTime = performance.now();
    const memoryTimeline: Array<{ time: number; memory: number }> = [];
    const progressTimeline: Array<{ time: number; value: number }> = [];

    const memoryInterval = setInterval(() => {
      memoryTimeline.push({ time: performance.now() - startTime, memory: getMemoryUsage() });
    }, 50);

    let result: CSRMatrix;

    const progressCb = (progress: number) => {
      progressTimeline.push({ time: performance.now() - startTime, value: progress });
      if (onProgress) onProgress(progress);
    };

    if (engine === 'webgpu') {
      try {
        await webGpuMatrix.init();
        if (webGpuMatrix.isSupported()) {
          result = await webGpuMatrix.multiply(matrixA, matrixB, useFP16, progressCb);
        } else {
          console.warn('WebGPU not supported, falling back to JS');
          result = multiplyCSR(matrixA, matrixB, progressCb);
        }
      } catch (e) {
        console.error('WebGPU failed, falling back to JS', e);
        result = multiplyCSR(matrixA, matrixB, progressCb);
      }
    } else if (engine === 'wasm') {
      const wasm = await loadWASM();
      if (wasm && wasm.__wbg_set_wasm) {
        const exports = (wasm as any).__wbg_get_wasm_exports?.();
        if (exports?.memory) wasmMemory = exports.memory;

        try {
          const estimatedSize = (matrixA.nnz + matrixB.nnz) * 16 + matrixA.rows * 8;
          ensureMemorySize(estimatedSize * 4);

          const aIndptrPtr = copyTypedArrayToWASM(matrixA.indptr, wasm);
          const aIndicesPtr = copyTypedArrayToWASM(matrixA.indices, wasm);
          const aDataPtr = copyTypedArrayToWASM(matrixA.data, wasm);
          const bIndptrPtr = copyTypedArrayToWASM(matrixB.indptr, wasm);
          const bIndicesPtr = copyTypedArrayToWASM(matrixB.indices, wasm);
          const bDataPtr = copyTypedArrayToWASM(matrixB.data, wasm);

          progressCb(5);

          const resultPtr = wasm.multiply_parallel_raw(
            matrixA.rows, matrixA.cols, aIndptrPtr, matrixA.indptr.length,
            aIndicesPtr, matrixA.indices.length, aDataPtr, matrixA.data.length,
            matrixB.rows, matrixB.cols, bIndptrPtr, matrixB.indptr.length,
            bIndicesPtr, matrixB.indices.length, bDataPtr, matrixB.data.length,
            progressCb
          );

          progressCb(95);

          const matrixPtr = wasm.get_result_matrix(resultPtr);
          const rows = wasm.__wbg_get_CSRMatrix_rows(matrixPtr);
          const cols = wasm.__wbg_get_CSRMatrix_cols(matrixPtr);
          const indptr = readUint32ArrayFromWASM(wasm.__wbg_get_CSRMatrix_indptr_ptr(matrixPtr), wasm.__wbg_get_CSRMatrix_indptr_len(matrixPtr));
          const indices = readUint32ArrayFromWASM(wasm.__wbg_get_CSRMatrix_indices_ptr(matrixPtr), wasm.__wbg_get_CSRMatrix_indices_len(matrixPtr));
          const data = readFloat64ArrayFromWASM(wasm.__wbg_get_CSRMatrix_data_ptr(matrixPtr), wasm.__wbg_get_CSRMatrix_data_len(matrixPtr));

          wasm.free_result_matrix(matrixPtr);
          wasm.__wbindgen_free(aIndptrPtr, matrixA.indptr.length * 4);
          wasm.__wbindgen_free(aIndicesPtr, matrixA.indices.length * 4);
          wasm.__wbindgen_free(aDataPtr, matrixA.data.length * 8);
          wasm.__wbindgen_free(bIndptrPtr, matrixB.indptr.length * 4);
          wasm.__wbindgen_free(bIndicesPtr, matrixB.indices.length * 4);
          wasm.__wbindgen_free(bDataPtr, matrixB.data.length * 8);

          result = { rows, cols, indptr, indices, data, nnz: data.length };
          progressCb(100);
        } catch (e) {
          console.error('WASM failed, falling back to JS', e);
          result = multiplyCSR(matrixA, matrixB, progressCb);
        }
      } else {
        result = multiplyCSR(matrixA, matrixB, progressCb);
      }
    } else {
      result = multiplyCSR(matrixA, matrixB, progressCb);
    }

    clearInterval(memoryInterval);
    const duration = performance.now() - startTime;
    const peakMemory = Math.max(...memoryTimeline.map((m) => m.memory), 0);

    return {
      taskId: Date.now().toString(),
      matrixC: result,
      duration,
      memoryUsage: { peak: peakMemory, timeline: memoryTimeline },
      progress: progressTimeline,
    };
  },

  async computeSVD(
    matrix: CSRMatrix,
    rank: number,
    onProgress?: (progress: number) => void
  ): Promise<SVDResult> {
    return computeSVD(matrix, rank, onProgress);
  },

  async computeEigenvalues(
    matrix: CSRMatrix,
    numEigenvalues: number,
    onProgress?: (progress: number) => void
  ): Promise<EigenResult> {
    return computeEigenvalues(matrix, numEigenvalues, onProgress);
  },

  async isWASMAvailable(): Promise<boolean> {
    try {
      await loadWASM();
      return !!(wasmModule && wasmModule.__wbg_set_wasm);
    } catch { return false; }
  },

  async isWebGPUAvailable(): Promise<boolean> {
    return await webGpuMatrix.init();
  },

  async supportsFP16(): Promise<boolean> {
    await webGpuMatrix.init();
    return webGpuMatrix.supportsFP16();
  },
};

export type WorkerApi = typeof workerApi;
Comlink.expose(workerApi);
