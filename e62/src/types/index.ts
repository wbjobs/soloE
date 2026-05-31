export interface CSRMatrix {
  rows: number;
  cols: number;
  indptr: Uint32Array;
  indices: Uint32Array;
  data: Float64Array;
  nnz: number;
}

export interface ComputeTask {
  id: string;
  matrixA: CSRMatrix;
  matrixB: CSRMatrix;
  engine: 'js' | 'wasm' | 'webgpu';
  useFP16?: boolean;
  timestamp: number;
}

export interface ComputeResult {
  taskId: string;
  matrixC: CSRMatrix;
  duration: number;
  memoryUsage: {
    peak: number;
    timeline: Array<{ time: number; memory: number }>;
  };
  progress: Array<{ time: number; value: number }>;
}

export interface SVDResult {
  U: Float64Array;
  S: Float64Array;
  V: Float64Array;
  rows: number;
  cols: number;
}

export interface EigenResult {
  values: Float64Array;
  vectors: Float64Array;
  n: number;
}

export interface MatrixInfo {
  id: string;
  name: string;
  rows: number;
  cols: number;
  nnz: number;
  density: number;
  createdAt: string;
}

export interface HistoryRecord {
  id: string;
  matrixA: MatrixInfo;
  matrixB: MatrixInfo;
  result: MatrixInfo;
  engine: string;
  duration: number;
  createdAt: string;
}

export interface PerformanceMetrics {
  jsDuration?: number;
  wasmDuration?: number;
  webgpuDuration?: number;
  speedup?: number;
  memoryJS?: number;
  memoryWASM?: number;
  memoryWebGPU?: number;
}
