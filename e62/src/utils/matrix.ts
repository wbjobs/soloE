import type { CSRMatrix } from '../types';

export function createEmptyMatrix(rows: number, cols: number): CSRMatrix {
  return {
    rows,
    cols,
    indptr: new Uint32Array(rows + 1),
    indices: new Uint32Array(),
    data: new Float64Array(),
    nnz: 0,
  };
}

export function createRandomSparseMatrix(
  rows: number,
  cols: number,
  density: number
): CSRMatrix {
  const indptr = new Uint32Array(rows + 1);
  const indices: number[] = [];
  const data: number[] = [];

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (Math.random() < density) {
        const value = Math.random() * 9.9 + 0.1;
        indices.push(j);
        data.push(value);
        indptr[i + 1]++;
      }
    }
    indptr[i + 1] += indptr[i];
  }

  return {
    rows,
    cols,
    indptr,
    indices: new Uint32Array(indices),
    data: new Float64Array(data),
    nnz: data.length,
  };
}

export function convertToDense(matrix: CSRMatrix): Float64Array {
  const result = new Float64Array(matrix.rows * matrix.cols);
  for (let i = 0; i < matrix.rows; i++) {
    for (let idx = matrix.indptr[i]; idx < matrix.indptr[i + 1]; idx++) {
      const j = matrix.indices[idx];
      result[i * matrix.cols + j] = matrix.data[idx];
    }
  }
  return result;
}

export function multiplyCSR(
  a: CSRMatrix,
  b: CSRMatrix,
  onProgress?: (progress: number) => void
): CSRMatrix {
  if (a.cols !== b.rows) {
    throw new Error('Matrix dimensions do not match for multiplication');
  }

  const m = a.rows;
  const n = b.cols;

  const rowResults: Array<{ col: number; val: number }[]> = [];

  for (let i = 0; i < m; i++) {
    if (onProgress && i % Math.ceil(m / 20) === 0) {
      onProgress(Math.floor((i / m) * 80));
    }

    const row = new Map<number, number>();

    for (let aIdx = a.indptr[i]; aIdx < a.indptr[i + 1]; aIdx++) {
      const aCol = a.indices[aIdx];
      const aVal = a.data[aIdx];

      for (let bIdx = b.indptr[aCol]; bIdx < b.indptr[aCol + 1]; bIdx++) {
        const bCol = b.indices[bIdx];
        const bVal = b.data[bIdx];
        const current = row.get(bCol) || 0;
        row.set(bCol, current + aVal * bVal);
      }
    }

    rowResults.push(
      Array.from(row.entries())
        .map(([col, val]) => ({ col, val }))
        .sort((x, y) => x.col - y.col)
    );
  }

  if (onProgress) {
    onProgress(85);
  }

  const indptr = new Uint32Array(m + 1);
  const indices: number[] = [];
  const data: number[] = [];

  for (let i = 0; i < m; i++) {
    if (onProgress && i % Math.ceil(m / 10) === 0) {
      onProgress(85 + Math.floor((i / m) * 15));
    }

    for (const { col, val } of rowResults[i]) {
      indices.push(col);
      data.push(val);
    }
    indptr[i + 1] = indptr[i] + rowResults[i].length;
  }

  if (onProgress) {
    onProgress(100);
  }

  return {
    rows: m,
    cols: n,
    indptr,
    indices: new Uint32Array(indices),
    data: new Float64Array(data),
    nnz: data.length,
  };
}

export function matrixToCSV(matrix: CSRMatrix): string {
  const dense = convertToDense(matrix);
  const rows: string[] = [];

  for (let i = 0; i < matrix.rows; i++) {
    const row: string[] = [];
    for (let j = 0; j < matrix.cols; j++) {
      row.push(dense[i * matrix.cols + j].toString());
    }
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

export function csvToMatrix(csv: string): CSRMatrix {
  const lines = csv.trim().split('\n');
  const rows = lines.length;
  const cols = lines[0].split(',').length;
  const data: number[] = [];

  for (const line of lines) {
    const values = line.split(',').map(v => parseFloat(v.trim()));
    data.push(...values);
  }

  const dense = new Float64Array(data);
  return denseToCSR(dense, rows, cols);
}

export function denseToCSR(
  dense: Float64Array,
  rows: number,
  cols: number
): CSRMatrix {
  const indptr = new Uint32Array(rows + 1);
  const indices: number[] = [];
  const data: number[] = [];

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const val = dense[i * cols + j];
      if (val !== 0 && !isNaN(val)) {
        indices.push(j);
        data.push(val);
        indptr[i + 1]++;
      }
    }
    indptr[i + 1] += indptr[i];
  }

  return {
    rows,
    cols,
    indptr,
    indices: new Uint32Array(indices),
    data: new Float64Array(data),
    nnz: data.length,
  };
}

export function getMemoryUsage(): number {
  if ((performance as any).memory) {
    return (performance as any).memory.usedJSHeapSize;
  }
  return 0;
}
