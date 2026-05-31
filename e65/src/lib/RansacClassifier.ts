import * as THREE from 'three';

export interface RansacParams {
  distanceThreshold: number;
  maxIterations: number;
  probability: number;
  minInliers: number;
}

export interface Plane {
  normal: THREE.Vector3;
  distance: number;
  inliers: number[];
}

export interface ClassificationStats {
  groundPoints: number;
  buildingPoints: number;
  vegetationPoints: number;
  unclassifiedPoints: number;
  iterationTimes: number[];
}

export class RansacClassifier {
  private positions: Float32Array;
  private params: RansacParams;
  private progressCallback: ((progress: number) => void) | null = null;

  constructor(
    positions: Float32Array,
    params: Partial<RansacParams> = {}
  ) {
    this.positions = positions;
    this.params = {
      distanceThreshold: 0.3,
      maxIterations: 1000,
      probability: 0.99,
      minInliers: 100,
      ...params,
    };
  }

  setProgressCallback(callback: (progress: number) => void) {
    this.progressCallback = callback;
  }

  private getRandomIndices(n: number, k: number): number[] {
    const indices: number[] = [];
    while (indices.length < k) {
      const idx = Math.floor(Math.random() * n);
      if (!indices.includes(idx)) {
        indices.push(idx);
      }
    }
    return indices;
  }

  private computePlane(p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3): Plane {
    const v1 = new THREE.Vector3().subVectors(p2, p1);
    const v2 = new THREE.Vector3().subVectors(p3, p1);
    const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();
    const distance = -normal.dot(p1);
    return { normal, distance, inliers: [] };
  }

  private computePointToPlaneDistance(
    pointIndex: number,
    plane: Plane
  ): number {
    const x = this.positions[pointIndex * 3];
    const y = this.positions[pointIndex * 3 + 1];
    const z = this.positions[pointIndex * 3 + 2];
    return Math.abs(plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.distance);
  }

  private findInliers(plane: Plane, pointCount: number): number[] {
    const inliers: number[] = [];
    for (let i = 0; i < pointCount; i++) {
      if (this.computePointToPlaneDistance(i, plane) < this.params.distanceThreshold) {
        inliers.push(i);
      }
    }
    return inliers;
  }

  fitPlane(mask?: boolean[]): Plane | null {
    const pointCount = this.positions.length / 3;
    let bestPlane: Plane | null = null;
    let bestInlierCount = 0;
    const startTime = performance.now();

    for (let iteration = 0; iteration < this.params.maxIterations; iteration++) {
      const indices = this.getRandomIndices(pointCount, 3);

      const p1 = new THREE.Vector3(
        this.positions[indices[0] * 3],
        this.positions[indices[0] * 3 + 1],
        this.positions[indices[0] * 3 + 2]
      );
      const p2 = new THREE.Vector3(
        this.positions[indices[1] * 3],
        this.positions[indices[1] * 3 + 1],
        this.positions[indices[1] * 3 + 2]
      );
      const p3 = new THREE.Vector3(
        this.positions[indices[2] * 3],
        this.positions[indices[2] * 3 + 1],
        this.positions[indices[2] * 3 + 2]
      );

      const plane = this.computePlane(p1, p2, p3);

      if (Math.abs(plane.normal.y) < 0.7) {
        continue;
      }

      const inliers = this.findInliers(plane, pointCount);
      plane.inliers = inliers;

      if (inliers.length > bestInlierCount) {
        bestInlierCount = inliers.length;
        bestPlane = plane;

        const e = 1 - (inliers.length / pointCount) ** 3;
        const newMaxIterations = Math.log(1 - this.params.probability) / Math.log(e);
        if (iteration >= newMaxIterations) break;
      }

      if (iteration % 100 === 0 && this.progressCallback) {
        this.progressCallback(iteration / this.params.maxIterations * 0.5);
      }
    }

    if (bestPlane && bestPlane.inliers.length < this.params.minInliers) {
      return null;
    }

    return bestPlane;
  }

  private computePointDensity(index: number, allIndices: number[], radius: number): number {
    const px = this.positions[index * 3];
    const py = this.positions[index * 3 + 1];
    const pz = this.positions[index * 3 + 2];
    let count = 0;

    for (const idx of allIndices) {
      const x = this.positions[idx * 3];
      const y = this.positions[idx * 3 + 1];
      const z = this.positions[idx * 3 + 2];
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2);
      if (dist < radius) count++;
    }

    return count / (4 / 3 * Math.PI * radius ** 3);
  }

  private computeHeightVariation(indices: number[]): number {
    let sumY = 0;
    for (const idx of indices) {
      sumY += this.positions[idx * 3 + 1];
    }
    const meanY = sumY / indices.length;

    let variance = 0;
    for (const idx of indices) {
      const y = this.positions[idx * 3 + 1];
      variance += (y - meanY) ** 2;
    }
    return Math.sqrt(variance / indices.length);
  }

  classify(): {
    ground: number[];
    buildings: number[];
    vegetation: number[];
    unclassified: number[];
    stats: ClassificationStats;
  } {
    const pointCount = this.positions.length / 3;
    const startTime = performance.now();

    const groundPlane = this.fitPlane();
    const groundPoints = groundPlane?.inliers || [];
    const groundSet = new Set(groundPoints);

    if (this.progressCallback) {
      this.progressCallback(0.6);
    }

    const nonGroundPoints: number[] = [];
    for (let i = 0; i < pointCount; i++) {
      if (!groundSet.has(i)) {
        nonGroundPoints.push(i);
      }
    }

    const buildingPoints: number[] = [];
    const vegetationPoints: number[] = [];
    const unclassifiedPoints: number[] = [];

    const sampleSize = Math.min(1000, nonGroundPoints.length);
    for (let i = 0; i < sampleSize; i++) {
      const idx = nonGroundPoints[Math.floor(Math.random() * nonGroundPoints.length)];
      const density = this.computePointDensity(idx, nonGroundPoints, 1.0);
      const localVariation = this.computeHeightVariation(
        nonGroundPoints.filter((_, j) => j % 10 === 0).slice(0, 100)
      );

      if (this.progressCallback && i % 100 === 0) {
        this.progressCallback(0.6 + (i / sampleSize) * 0.4);
      }
    }

    for (let i = 0; i < nonGroundPoints.length; i++) {
      const idx = nonGroundPoints[i];
      const y = this.positions[idx * 3 + 1];

      const localNeighbors: number[] = [];
      for (let j = 0; j < Math.min(50, nonGroundPoints.length); j++) {
        const nIdx = nonGroundPoints[(i + j) % nonGroundPoints.length];
        const dx = this.positions[idx * 3] - this.positions[nIdx * 3];
        const dy = this.positions[idx * 3 + 1] - this.positions[nIdx * 3 + 1];
        const dz = this.positions[idx * 3 + 2] - this.positions[nIdx * 3 + 2];
        if (dx * dx + dy * dy + dz * dz < 1.0) {
          localNeighbors.push(nIdx);
        }
      }

      let minY = Infinity, maxY = -Infinity;
      for (const nIdx of localNeighbors) {
        minY = Math.min(minY, this.positions[nIdx * 3 + 1]);
        maxY = Math.max(maxY, this.positions[nIdx * 3 + 1]);
      }
      const heightVariation = maxY - minY;

      if (heightVariation < 0.5) {
        buildingPoints.push(idx);
      } else if (heightVariation > 1.0) {
        vegetationPoints.push(idx);
      } else {
        if (y > 2.0) {
          vegetationPoints.push(idx);
        } else {
          buildingPoints.push(idx);
        }
      }
    }

    const endTime = performance.now();

    return {
      ground: groundPoints,
      buildings: buildingPoints,
      vegetation: vegetationPoints,
      unclassified: unclassifiedPoints,
      stats: {
        groundPoints: groundPoints.length,
        buildingPoints: buildingPoints.length,
        vegetationPoints: vegetationPoints.length,
        unclassifiedPoints: unclassifiedPoints.length,
        iterationTimes: [endTime - startTime],
      },
    };
  }

  static getClassColor(type: string): [number, number, number] {
    switch (type) {
      case 'ground':
        return [0.76, 0.70, 0.50];
      case 'building':
        return [0.80, 0.36, 0.36];
      case 'vegetation':
        return [0.27, 0.68, 0.31];
      default:
        return [0.5, 0.5, 0.5];
    }
  }

  static getClassName(type: string): string {
    switch (type) {
      case 'ground':
        return '地面';
      case 'building':
        return '建筑物';
      case 'vegetation':
        return '植被';
      default:
        return '未分类';
    }
  }
}
