class ICP {
  constructor(maxIterations = 50, tolerance = 1e-6) {
    this.maxIterations = maxIterations;
    this.tolerance = tolerance;
  }

  computeCentroid(points) {
    const n = points.length;
    const centroid = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      centroid[0] += points[i][0];
      centroid[1] += points[i][1];
      centroid[2] += points[i][2];
    }
    return [centroid[0] / n, centroid[1] / n, centroid[2] / n];
  }

  subtractCentroid(points, centroid) {
    return points.map(p => [
      p[0] - centroid[0],
      p[1] - centroid[1],
      p[2] - centroid[2]
    ]);
  }

  findClosestPoints(source, target) {
    const correspondences = [];
    for (let i = 0; i < source.length; i++) {
      let minDist = Infinity;
      let closestIdx = 0;
      for (let j = 0; j < target.length; j++) {
        const dist = this.squaredDistance(source[i], target[j]);
        if (dist < minDist) {
          minDist = dist;
          closestIdx = j;
        }
      }
      correspondences.push({ source: i, target: closestIdx, dist: Math.sqrt(minDist) });
    }
    return correspondences;
  }

  squaredDistance(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  }

  computeRotation(sourceCentered, targetCentered, correspondences) {
    const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < correspondences.length; i++) {
      const s = sourceCentered[correspondences[i].source];
      const t = targetCentered[correspondences[i].target];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          H[r][c] += s[r] * t[c];
        }
      }
    }

    const { U, Vt } = this.svd3x3(H);
    
    let R = this.multiplyMatrix(Vt, this.transposeMatrix(U));
    
    const det = this.determinant3x3(R);
    if (det < 0) {
      Vt[2][0] *= -1;
      Vt[2][1] *= -1;
      Vt[2][2] *= -1;
      R = this.multiplyMatrix(Vt, this.transposeMatrix(U));
    }

    return R;
  }

  svd3x3(A) {
    const AtA = this.multiplyMatrix(this.transposeMatrix(A), A);
    const eigenvalues = this.computeEigenvalues(AtA);
    const eigenvectors = this.computeEigenvectors(AtA, eigenvalues);

    const S = eigenvalues.map(v => Math.sqrt(Math.max(0, v)));
    const V = eigenvectors;
    
    const Sinv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) {
      if (S[i] > 1e-10) {
        Sinv[i][i] = 1 / S[i];
      }
    }
    
    const U = this.multiplyMatrix(this.multiplyMatrix(A, V), Sinv);

    return { U, S, Vt: this.transposeMatrix(V) };
  }

  computeEigenvalues(matrix) {
    const m = matrix;
    const a = m[0][0], b = m[0][1], c = m[0][2];
    const d = m[1][0], e = m[1][1], f = m[1][2];
    const g = m[2][0], h = m[2][1], i = m[2][2];

    const trace = a + e + i;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    const minor = (a * e - b * d) + (a * i - c * g) + (e * i - f * h);

    const p = trace * trace - 3 * minor;
    const q = 2 * trace * trace * trace - 9 * trace * minor + 27 * det;
    const r = Math.sqrt(Math.abs(p * p * p - q * q));
    
    const phi = Math.atan2(r, q) / 3;
    const sqrtP = Math.sqrt(p / 3);
    
    const lambda1 = trace / 3 + 2 * sqrtP * Math.cos(phi);
    const lambda2 = trace / 3 + 2 * sqrtP * Math.cos(phi + 2 * Math.PI / 3);
    const lambda3 = trace / 3 + 2 * sqrtP * Math.cos(phi + 4 * Math.PI / 3);

    return [lambda1, lambda2, lambda3].sort((x, y) => y - x);
  }

  computeEigenvectors(matrix, eigenvalues) {
    const vectors = [];
    for (const lambda of eigenvalues) {
      const m = [
        [matrix[0][0] - lambda, matrix[0][1], matrix[0][2]],
        [matrix[1][0], matrix[1][1] - lambda, matrix[1][2]],
        [matrix[2][0], matrix[2][1], matrix[2][2] - lambda]
      ];
      
      const v = this.solveHomogeneousSystem(m);
      vectors.push(v);
    }
    return this.orthonormalize(vectors);
  }

  solveHomogeneousSystem(m) {
    const cross1 = this.cross([m[0][0], m[0][1], m[0][2]], [m[1][0], m[1][1], m[1][2]]);
    const cross2 = this.cross([m[1][0], m[1][1], m[1][2]], [m[2][0], m[2][1], m[2][2]]);
    const cross3 = this.cross([m[0][0], m[0][1], m[0][2]], [m[2][0], m[2][1], m[2][2]]);
    
    const norm1 = this.norm(cross1);
    const norm2 = this.norm(cross2);
    const norm3 = this.norm(cross3);
    
    let best;
    if (norm1 > norm2 && norm1 > norm3) best = cross1;
    else if (norm2 > norm3) best = cross2;
    else best = cross3;
    
    const n = this.norm(best);
    if (n < 1e-10) return [1, 0, 0];
    return [best[0] / n, best[1] / n, best[2] / n];
  }

  cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  norm(v) {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  }

  orthonormalize(vectors) {
    const result = [];
    for (const v of vectors) {
      let u = [...v];
      for (const r of result) {
        const dot = u[0] * r[0] + u[1] * r[1] + u[2] * r[2];
        u = [u[0] - dot * r[0], u[1] - dot * r[1], u[2] - dot * r[2]];
      }
      const n = this.norm(u);
      if (n > 1e-10) {
        result.push([u[0] / n, u[1] / n, u[2] / n]);
      }
    }
    while (result.length < 3) {
      result.push([0, 0, 0]);
    }
    return result;
  }

  multiplyMatrix(A, B) {
    const result = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) {
          result[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    return result;
  }

  transposeMatrix(A) {
    return [
      [A[0][0], A[1][0], A[2][0]],
      [A[0][1], A[1][1], A[2][1]],
      [A[0][2], A[1][2], A[2][2]]
    ];
  }

  determinant3x3(A) {
    return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
         - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
         + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  }

  applyTransform(points, R, t) {
    return points.map(p => [
      R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + t[0],
      R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + t[1],
      R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2]
    ]);
  }

  meanSquaredError(correspondences) {
    let sum = 0;
    for (const c of correspondences) {
      sum += c.dist * c.dist;
    }
    return sum / correspondences.length;
  }

  register(source, target) {
    let currentSource = source.map(p => [...p]);
    let prevError = Infinity;
    let R_total = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let t_total = [0, 0, 0];

    for (let iter = 0; iter < this.maxIterations; iter++) {
      const sourceCentroid = this.computeCentroid(currentSource);
      const targetCentroid = this.computeCentroid(target);
      const sourceCentered = this.subtractCentroid(currentSource, sourceCentroid);
      const targetCentered = this.subtractCentroid(target, targetCentroid);
      const correspondences = this.findClosestPoints(currentSource, target);
      const R = this.computeRotation(sourceCentered, targetCentered, correspondences);
      const t = [
        targetCentroid[0] - (R[0][0] * sourceCentroid[0] + R[0][1] * sourceCentroid[1] + R[0][2] * sourceCentroid[2]),
        targetCentroid[1] - (R[1][0] * sourceCentroid[0] + R[1][1] * sourceCentroid[1] + R[1][2] * sourceCentroid[2]),
        targetCentroid[2] - (R[2][0] * sourceCentroid[0] + R[2][1] * sourceCentroid[1] + R[2][2] * sourceCentroid[2])
      ];
      currentSource = this.applyTransform(currentSource, R, t);
      R_total = this.multiplyMatrix(R, R_total);
      t_total = [
        R[0][0] * t_total[0] + R[0][1] * t_total[1] + R[0][2] * t_total[2] + t[0],
        R[1][0] * t_total[0] + R[1][1] * t_total[1] + R[1][2] * t_total[2] + t[1],
        R[2][0] * t_total[0] + R[2][1] * t_total[1] + R[2][2] * t_total[2] + t[2]
      ];
      const error = this.meanSquaredError(correspondences);
      if (Math.abs(prevError - error) < this.tolerance) {
        break;
      }
      prevError = error;
    }
    return {
      transformedSource: currentSource,
      rotation: R_total,
      translation: t_total
    };
  }
}

module.exports = ICP;
