import type { CSRMatrix } from '../types';
import { convertToDense } from './matrix';

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

function multiplyMatrixVector(matrix: Float64Array, rows: number, cols: number, vec: Float64Array): Float64Array {
  const result = new Float64Array(rows);
  for (let i = 0; i < rows; i++) {
    let sum = 0;
    for (let j = 0; j < cols; j++) {
      sum += matrix[i * cols + j] * vec[j];
    }
    result[i] = sum;
  }
  return result;
}

function transposeMatrix(matrix: Float64Array, rows: number, cols: number): Float64Array {
  const result = new Float64Array(cols * rows);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j * rows + i] = matrix[i * cols + j];
    }
  }
  return result;
}

function normalizeVector(vec: Float64Array): Float64Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  const result = new Float64Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    result[i] = vec[i] / norm;
  }
  return result;
}

function dotProduct(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function orthonormalize(vectors: Float64Array[], n: number): Float64Array[] {
  const result: Float64Array[] = [];
  for (let i = 0; i < vectors.length; i++) {
    let v = new Float64Array(vectors[i]);
    for (let j = 0; j < i; j++) {
      const proj = dotProduct(v, result[j]);
      for (let k = 0; k < n; k++) {
        v[k] -= proj * result[j][k];
      }
    }
    v = normalizeVector(v);
    result.push(v);
  }
  return result;
}

export function computeEigenvalues(
  csrMatrix: CSRMatrix,
  numEigenvalues: number = 10,
  onProgress?: (progress: number) => void
): EigenResult {
  const n = csrMatrix.rows;
  const dense = convertToDense(csrMatrix);
  const eigenvectors: Float64Array[] = [];
  const eigenvalues: number[] = [];

  const k = Math.min(numEigenvalues, n);

  for (let iter = 0; iter < k; iter++) {
    onProgress?.(Math.floor((iter / k) * 80));

    let b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      b[i] = Math.random() - 0.5;
    }
    b = normalizeVector(b);

    let prevLambda = 0;
    for (let powerIter = 0; powerIter < 100; powerIter++) {
      b = multiplyMatrixVector(dense, n, n, b);
      b = normalizeVector(b);

      for (let j = 0; j < iter; j++) {
        const proj = dotProduct(b, eigenvectors[j]);
        for (let k = 0; k < n; k++) {
          b[k] -= proj * eigenvectors[j][k];
        }
      }
      b = normalizeVector(b);

      const Ab = multiplyMatrixVector(dense, n, n, b);
      const lambda = dotProduct(b, Ab);

      if (Math.abs(lambda - prevLambda) < 1e-10) {
        break;
      }
      prevLambda = lambda;
    }

    const Ab = multiplyMatrixVector(dense, n, n, b);
    const lambda = dotProduct(b, Ab);

    eigenvectors.push(b);
    eigenvalues.push(lambda);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        dense[i * n + j] -= lambda * b[i] * b[j];
      }
    }
  }

  onProgress?.(85);

  const vectorsArray = new Float64Array(k * n);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < n; j++) {
      vectorsArray[i * n + j] = eigenvectors[i][j];
    }
  }

  onProgress?.(100);

  return {
    values: new Float64Array(eigenvalues),
    vectors: vectorsArray,
    n: k,
  };
}

export function computeSVD(
  csrMatrix: CSRMatrix,
  rank: number = 10,
  onProgress?: (progress: number) => void
): SVDResult {
  const m = csrMatrix.rows;
  const n = csrMatrix.cols;
  const k = Math.min(rank, Math.min(m, n));

  onProgress?.(10);

  const A = convertToDense(csrMatrix);
  const At = transposeMatrix(A, m, n);

  const AtA = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let l = 0; l < m; l++) {
        sum += At[i * m + l] * A[l * n + j];
      }
      AtA[i * n + j] = sum;
    }
  }

  onProgress?.(30);

  const eigenvectors: Float64Array[] = [];
  const singularValues: number[] = [];

  for (let iter = 0; iter < k; iter++) {
    onProgress?.(30 + Math.floor((iter / k) * 50));

    let v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      v[i] = Math.random() - 0.5;
    }
    v = normalizeVector(v);

    for (let powerIter = 0; powerIter < 50; powerIter++) {
      v = multiplyMatrixVector(AtA, n, n, v);
      v = normalizeVector(v);

      for (let j = 0; j < iter; j++) {
        const proj = dotProduct(v, eigenvectors[j]);
        for (let l = 0; l < n; l++) {
          v[l] -= proj * eigenvectors[j][l];
        }
      }
      v = normalizeVector(v);
    }

    const Av = multiplyMatrixVector(A, m, n, v);
    const sigma = Math.sqrt(dotProduct(v, multiplyMatrixVector(AtA, n, n, v)));

    eigenvectors.push(v);
    singularValues.push(sigma);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        AtA[i * n + j] -= sigma * sigma * v[i] * v[j];
      }
    }
  }

  onProgress?.(85);

  const V = new Float64Array(n * k);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < n; j++) {
      V[j * k + i] = eigenvectors[i][j];
    }
  }

  const U = new Float64Array(m * k);
  for (let i = 0; i < k; i++) {
    if (singularValues[i] > 1e-10) {
      const v = eigenvectors[i];
      const u = multiplyMatrixVector(A, m, n, v);
      for (let j = 0; j < m; j++) {
        U[j * k + i] = u[j] / singularValues[i];
      }
    }
  }

  const uVectors: Float64Array[] = [];
  for (let i = 0; i < k; i++) {
    const vec = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      vec[j] = U[j * k + i];
    }
    uVectors.push(vec);
  }
  const orthoU = orthonormalize(uVectors, m);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < m; j++) {
      U[j * k + i] = orthoU[i][j];
    }
  }

  onProgress?.(100);

  return {
    U,
    S: new Float64Array(singularValues),
    V,
    rows: m,
    cols: n,
  };
}

export function reconstructFromSVD(svd: SVDResult, rank: number): Float64Array {
  const k = Math.min(rank, svd.S.length);
  const m = svd.rows;
  const n = svd.cols;

  const result = new Float64Array(m * n);

  for (let r = 0; r < k; r++) {
    const sigma = svd.S[r];
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        result[i * n + j] += sigma * svd.U[i * k + r] * svd.V[j * k + r];
      }
    }
  }

  return result;
}
