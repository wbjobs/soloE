import { create } from 'zustand';
import type { CSRMatrix, ComputeResult, HistoryRecord, SVDResult, EigenResult } from '../types';
import { createRandomSparseMatrix } from '../utils/matrix';

type OperationMode = 'multiply' | 'svd' | 'eigen';

interface MatrixState {
  matrixA: CSRMatrix | null;
  matrixB: CSRMatrix | null;
  result: ComputeResult | null;
  svdResult: SVDResult | null;
  eigenResult: EigenResult | null;
  isComputing: boolean;
  progress: number;
  computeEngine: 'js' | 'wasm' | 'webgpu';
  useFP16: boolean;
  svdRank: number;
  eigenCount: number;
  operationMode: OperationMode;
  history: HistoryRecord[];
  webgpuAvailable: boolean;
  wasmAvailable: boolean;

  setMatrixA: (matrix: CSRMatrix) => void;
  setMatrixB: (matrix: CSRMatrix) => void;
  setResult: (result: ComputeResult | null) => void;
  setSVDResult: (result: SVDResult | null) => void;
  setEigenResult: (result: EigenResult | null) => void;
  setIsComputing: (computing: boolean) => void;
  setProgress: (progress: number) => void;
  setComputeEngine: (engine: 'js' | 'wasm' | 'webgpu') => void;
  setUseFP16: (use: boolean) => void;
  setSvdRank: (rank: number) => void;
  setEigenCount: (count: number) => void;
  setOperationMode: (mode: OperationMode) => void;
  setWebgpuAvailable: (available: boolean) => void;
  setWasmAvailable: (available: boolean) => void;
  generateRandomMatrices: (size: number, density: number) => void;
  addToHistory: (record: HistoryRecord) => void;
  clearAllResults: () => void;
}

export const useMatrixStore = create<MatrixState>((set, get) => ({
  matrixA: null,
  matrixB: null,
  result: null,
  svdResult: null,
  eigenResult: null,
  isComputing: false,
  progress: 0,
  computeEngine: 'js',
  useFP16: false,
  svdRank: 10,
  eigenCount: 10,
  operationMode: 'multiply',
  history: [],
  webgpuAvailable: false,
  wasmAvailable: false,

  setMatrixA: (matrix) => set({ matrixA: matrix }),
  setMatrixB: (matrix) => set({ matrixB: matrix }),
  setResult: (result) => set({ result }),
  setSVDResult: (result) => set({ svdResult: result }),
  setEigenResult: (result) => set({ eigenResult: result }),
  setIsComputing: (computing) => set({ isComputing: computing }),
  setProgress: (progress) => set({ progress }),
  setComputeEngine: (engine) => set({ computeEngine: engine }),
  setUseFP16: (use) => set({ useFP16: use }),
  setSvdRank: (rank) => set({ svdRank: rank }),
  setEigenCount: (count) => set({ eigenCount: count }),
  setOperationMode: (mode) => set({ operationMode: mode }),
  setWebgpuAvailable: (available) => set({ webgpuAvailable: available }),
  setWasmAvailable: (available) => set({ wasmAvailable: available }),

  generateRandomMatrices: (size, density) => {
    const matrixA = createRandomSparseMatrix(size, size, density);
    const matrixB = createRandomSparseMatrix(size, size, density);
    set({ matrixA, matrixB, result: null, svdResult: null, eigenResult: null });
  },

  addToHistory: (record) => {
    set((state) => ({
      history: [record, ...state.history].slice(0, 50),
    }));
  },

  clearAllResults: () => set({ result: null, svdResult: null, eigenResult: null }),
}));
