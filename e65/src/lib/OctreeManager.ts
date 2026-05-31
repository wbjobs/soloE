import * as THREE from 'three';
import { OctreeNode, PointCloudChunk } from '../../shared/types';

interface LoadedChunk {
  nodeId: string;
  lodLevel: number;
  points: THREE.Points;
  lastUsed: number;
}

interface BuildProgress {
  processed: number;
  total: number;
}

export class OctreeManager {
  private nodes: Map<string, OctreeNode> = new Map();
  private loadedChunks: Map<string, LoadedChunk> = new Map();
  private rootNode: OctreeNode | null = null;
  private scene: THREE.Scene;
  private maxLoadedPoints: number = 2000000;
  private maxTreeDepth: number = 5;
  private minPointsPerNode: number = 1000;
  private lodDistanceThresholds: number[] = [30, 60, 120, 240];
  private isBuilding: boolean = false;
  private buildWorker: Worker | null = null;
  private rawPositions: Float32Array | null = null;
  private rawColors: Float32Array | null = null;
  private onProgress: (progress: BuildProgress) => void = () => {};

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setProgressCallback(callback: (progress: BuildProgress) => void) {
    this.onProgress = callback;
  }

  setOctreeData(rootNode: OctreeNode, allNodes: OctreeNode[]) {
    this.rootNode = rootNode;
    this.nodes.clear();
    allNodes.forEach((node) => this.nodes.set(node.id, node));
  }

  setRawData(positions: Float32Array, colors?: Float32Array) {
    this.rawPositions = positions;
    this.rawColors = colors || null;
  }

  async buildOctreeFromPoints(
    positions: Float32Array,
    colors?: Float32Array,
    maxDepth: number = 5
  ): Promise<{ root: OctreeNode; nodes: OctreeNode[] }> {
    this.isBuilding = true;
    this.rawPositions = positions;
    this.rawColors = colors || null;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    const pointCount = positions.length / 3;
    for (let i = 0; i < pointCount; i++) {
      minX = Math.min(minX, positions[i * 3]);
      minY = Math.min(minY, positions[i * 3 + 1]);
      minZ = Math.min(minZ, positions[i * 3 + 2]);
      maxX = Math.max(maxX, positions[i * 3]);
      maxY = Math.max(maxY, positions[i * 3 + 1]);
      maxZ = Math.max(maxZ, positions[i * 3 + 2]);
    }

    const bounds = {
      min: [minX, minY, minZ] as [number, number, number],
      max: [maxX, maxY, maxZ] as [number, number, number],
    };

    const nodes: OctreeNode[] = [];
    const pointIndices = new Array(pointCount).fill(0).map((_, i) => i);

    const buildNode = (
      nodeBounds: typeof bounds,
      depth: number,
      indices: number[]
    ): OctreeNode => {
      const center: [number, number, number] = [
        (nodeBounds.min[0] + nodeBounds.max[0]) / 2,
        (nodeBounds.min[1] + nodeBounds.max[1]) / 2,
        (nodeBounds.min[2] + nodeBounds.max[2]) / 2,
      ];

      const node: OctreeNode = {
        id: `node-${depth}-${nodes.length}`,
        level: depth,
        bounds: nodeBounds,
        center,
        pointCount: indices.length,
        children: [],
        lodLevels: [0, 1, 2, 3].slice(0, Math.max(1, 4 - depth)),
      };

      nodes.push(node);

      if (
        depth < maxDepth && indices.length > this.minPointsPerNode * 8) {
        const midX = center[0];
        const midY = center[1];
        const midZ = center[2];

        const childIndices: number[][] = Array(8).fill(null).map(() => []);

        for (const idx of indices) {
          const x = positions[idx * 3];
          const y = positions[idx * 3 + 1];
          const z = positions[idx * 3 + 2];

          let childIdx = 0;
          if (x >= midX) childIdx |= 1;
          if (y >= midY) childIdx |= 2;
          if (z >= midZ) childIdx |= 4;

          childIndices[childIdx].push(idx);
        }

        for (let i = 0; i < 8; i++) {
          if (childIndices[i].length > 0) {
            const childBounds = {
              min: [
                i & 1 ? midX : nodeBounds.min[0],
                i & 2 ? midY : nodeBounds.min[1],
                i & 4 ? midZ : nodeBounds.min[2],
              ] as [number, number, number],
              max: [
                i & 1 ? nodeBounds.max[0] : midX,
                i & 2 ? nodeBounds.max[1] : midY,
                i & 4 ? nodeBounds.max[2] : midZ,
              ] as [number, number, number],
            };

            const child = buildNode(childBounds, depth + 1, childIndices[i]);
            node.children.push(child.id);
          }
        }
      }

      return node;
    };

    const root = buildNode(bounds, 0, pointIndices);
    this.isBuilding = false;

    return { root, nodes };
  }

  update(camera: THREE.PerspectiveCamera) {
    if (!this.rootNode || this.isBuilding) return;

    const frustum = new THREE.Frustum();
    const matrix = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(matrix);

    const visibleNodes = this.getVisibleNodes(this.rootNode, frustum, camera);
    
    this.loadVisibleChunks(visibleNodes, camera);
    this.unloadInvisibleChunks(visibleNodes);
  }

  private getVisibleNodes(
    node: OctreeNode,
    frustum: THREE.Frustum,
    camera: THREE.PerspectiveCamera
  ): OctreeNode[] {
    const box = new THREE.Box3(
      new THREE.Vector3(...node.bounds.min),
      new THREE.Vector3(...node.bounds.max)
    );

    if (!frustum.intersectsBox(box)) {
      return [];
    }

    const distance = camera.position.distanceTo(
      new THREE.Vector3(...node.center)
    );

    const thresholdIndex = Math.min(node.level, this.lodDistanceThresholds.length - 1);
    const shouldSubdivide = 
      node.children.length > 0 && 
      distance < this.lodDistanceThresholds[thresholdIndex];

    if (shouldSubdivide) {
      const childNodes: OctreeNode[] = [];
      for (const childId of node.children) {
        const child = this.nodes.get(childId);
        if (child) {
          childNodes.push(...this.getVisibleNodes(child, frustum, camera));
        }
      }
      return childNodes.length > 0 ? childNodes : [node];
    }

    return [node];
  }

  private loadVisibleChunks(nodes: OctreeNode[], camera: THREE.PerspectiveCamera) {
    let totalPoints = 0;
    const sortedNodes = [...nodes].sort((a, b) => {
      const distA = camera.position.distanceTo(new THREE.Vector3(...a.center));
      const distB = camera.position.distanceTo(new THREE.Vector3(...b.center));
      return distA - distB;
    });

    for (const node of sortedNodes) {
      if (totalPoints >= this.maxLoadedPoints) break;

      const distance = camera.position.distanceTo(
        new THREE.Vector3(...node.center)
      );
      const lodLevel = this.getLODLevelForDistance(distance, node.level);
      const chunkKey = `${node.id}-${lodLevel}`;

      if (!this.loadedChunks.has(chunkKey)) {
        this.loadChunk(node, lodLevel);
      } else {
        const chunk = this.loadedChunks.get(chunkKey)!;
        chunk.lastUsed = Date.now();
      }

      totalPoints += Math.floor(node.pointCount / Math.pow(2, lodLevel));
    }
  }

  private getLODLevelForDistance(distance: number, nodeLevel: number): number {
    for (let i = 0; i < this.lodDistanceThresholds.length; i++) {
      if (distance < this.lodDistanceThresholds[i]) {
        return Math.max(0, Math.min(i, 3));
      }
    }
    return 3;
  }

  private loadChunk(node: OctreeNode, lodLevel: number) {
    const chunk = this.generateChunkData(node, lodLevel);
    this.createPointCloud(chunk);
  }

  private generateChunkData(node: OctreeNode, lodLevel: number): PointCloudChunk {
    const downsampleFactor = Math.pow(2, lodLevel);
    const pointCount = Math.floor(node.pointCount / downsampleFactor);

    if (!this.rawPositions) {
      const positions = new Float32Array(pointCount * 3);
      const colors = new Float32Array(pointCount * 3);

      const size = [
        node.bounds.max[0] - node.bounds.min[0],
        node.bounds.max[1] - node.bounds.min[1],
        node.bounds.max[2] - node.bounds.min[2],
      ];

      for (let i = 0; i < pointCount; i++) {
        const x = node.bounds.min[0] + Math.random() * size[0];
        const y = node.bounds.min[1] + Math.random() * size[1];
        const z = node.bounds.min[2] + Math.random() * size[2];

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        const height = (y - node.bounds.min[1]) / (size[1] || 1);
        colors[i * 3] = Math.min(1, height * 2);
        colors[i * 3 + 1] = Math.min(1, 1 - Math.abs(height - 0.5) * 2);
        colors[i * 3 + 2] = Math.min(1, (1 - height) * 2);
      }

      return {
        nodeId: node.id,
        lodLevel,
        positions,
        colors,
        pointCount,
      };
    }

    const positions = new Float32Array(pointCount * 3);
    const colors = this.rawColors ? new Float32Array(pointCount * 3) : undefined;

    for (let i = 0; i < pointCount; i++) {
      const srcIdx = i * downsampleFactor * 3;
      const dstIdx = i * 3;

      positions[dstIdx] = this.rawPositions[srcIdx];
      positions[dstIdx + 1] = this.rawPositions[srcIdx + 1];
      positions[dstIdx + 2] = this.rawPositions[srcIdx + 2];

      if (colors && this.rawColors) {
        colors[dstIdx] = this.rawColors[srcIdx];
        colors[dstIdx + 1] = this.rawColors[srcIdx + 1];
        colors[dstIdx + 2] = this.rawColors[srcIdx + 2];
      }
    }

    return {
      nodeId: node.id,
      lodLevel,
      positions,
      colors,
      pointCount,
    };
  }

  private createPointCloud(chunk: PointCloudChunk) {
    if (!this.scene) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));

    if (chunk.colors && chunk.colors.length > 0) {
      geometry.setAttribute('color', new THREE.BufferAttribute(chunk.colors, 3));
    }

    const material = new THREE.PointsMaterial({
      size: 1.5,
      vertexColors: chunk.colors && chunk.colors.length > 0,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);

    const chunkKey = `${chunk.nodeId}-${chunk.lodLevel}`;
    this.loadedChunks.set(chunkKey, {
      nodeId: chunk.nodeId,
      lodLevel: chunk.lodLevel,
      points,
      lastUsed: Date.now(),
    });
  }

  private unloadInvisibleChunks(visibleNodes: OctreeNode[]) {
    const visibleKeys = new Set<string>();
    for (const node of visibleNodes) {
      for (let lod = 0; lod <= 3; lod++) {
        visibleKeys.add(`${node.id}-${lod}`);
      }
    }

    const now = Date.now();
    const maxAge = 10000;

    for (const [key, chunk] of this.loadedChunks.entries()) {
      if (!visibleKeys.has(key) && now - chunk.lastUsed > maxAge) {
        try {
          this.scene.remove(chunk.points);
          chunk.points.geometry.dispose();
          (chunk.points.material as THREE.Material).dispose();
          this.loadedChunks.delete(key);
        } catch (e) {
          console.warn('Error unloading chunk:', e);
        }
      }
    }
  }

  getLoadedPointCount(): number {
    let count = 0;
    for (const chunk of this.loadedChunks.values()) {
      try {
        count += chunk.points.geometry.attributes.position.count;
      } catch (e) {
      }
    }
    return count;
  }

  updateColorMode(colorMode: string, uniformColor?: string) {
    for (const chunk of this.loadedChunks.values()) {
      const material = chunk.points.material as THREE.PointsMaterial;
      const positionAttr = chunk.points.geometry.getAttribute('position') as THREE.BufferAttribute;

      if (colorMode === 'uniform' && uniformColor) {
        material.vertexColors = false;
        material.color.set(uniformColor);
        chunk.points.geometry.deleteAttribute('color');
      } else if (colorMode === 'elevation') {
        const positions = positionAttr.array as Float32Array;
        const colors = new Float32Array(positions.length);

        let minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < positions.length / 3; i++) {
          minY = Math.min(minY, positions[i * 3 + 1]);
          maxY = Math.max(maxY, positions[i * 3 + 1]);
        }

        const heightRange = maxY - minY || 1;
        for (let i = 0; i < positions.length / 3; i++) {
          const y = positions[i * 3 + 1];
          const normalizedHeight = (y - minY) / heightRange;
          const color = new THREE.Color();
          color.setHSL(0.65 * (1 - normalizedHeight), 0.8, 0.5);
          colors[i * 3] = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
        }

        chunk.points.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        material.vertexColors = true;
        material.needsUpdate = true;
      } else if (colorMode === 'rgb') {
        material.vertexColors = true;
        material.needsUpdate = true;
      }
    }
  }

  updatePointSize(size: number) {
    for (const chunk of this.loadedChunks.values()) {
      const material = chunk.points.material as THREE.PointsMaterial;
      material.size = size;
      material.needsUpdate = true;
    }
  }

  dispose() {
    try {
      for (const chunk of this.loadedChunks.values()) {
        this.scene.remove(chunk.points);
        chunk.points.geometry.dispose();
        (chunk.points.material as THREE.Material).dispose();
      }
      this.loadedChunks.clear();
      this.nodes.clear();
      this.rootNode = null;
      this.rawPositions = null;
      this.rawColors = null;

      if (this.buildWorker) {
        this.buildWorker.terminate();
        this.buildWorker = null;
      }
    } catch (e) {
      console.error('Error disposing OctreeManager:', e);
    }
  }

  static generateMockOctree(maxDepth: number = 4): { root: OctreeNode; nodes: OctreeNode[] } {
    const nodes: OctreeNode[] = [];
    
    const rootBounds = {
      min: [-100, -50, -100] as [number, number, number],
      max: [100, 50, 100] as [number, number, number],
    };

    const rootNode: OctreeNode = {
      id: 'root',
      level: 0,
      bounds: rootBounds,
      center: [0, 0, 0],
      pointCount: 500000,
      children: [],
      lodLevels: [0, 1, 2, 3],
    };

    nodes.push(rootNode);

    const subdivide = (parent: OctreeNode, levels: number) => {
      if (levels === 0) return;

      const midX = (parent.bounds.min[0] + parent.bounds.max[0]) / 2;
      const midY = (parent.bounds.min[1] + parent.bounds.max[1]) / 2;
      const midZ = (parent.bounds.min[2] + parent.bounds.max[2]) / 2;

      for (let i = 0; i < 8; i++) {
        const minX = i & 1 ? midX : parent.bounds.min[0];
        const maxX = i & 1 ? parent.bounds.max[0] : midX;
        const minY = i & 2 ? midY : parent.bounds.min[1];
        const maxY = i & 2 ? parent.bounds.max[1] : midY;
        const minZ = i & 4 ? midZ : parent.bounds.min[2];
        const maxZ = i & 4 ? parent.bounds.max[2] : midZ;

        const childNode: OctreeNode = {
          id: `${parent.id}-${i}`,
          level: parent.level + 1,
          bounds: {
            min: [minX, minY, minZ] as [number, number, number],
            max: [maxX, maxY, maxZ] as [number, number, number],
          },
          center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
          pointCount: Math.floor(parent.pointCount / 8),
          children: [],
          lodLevels: [0, 1, 2].slice(0, Math.max(1, 4 - parent.level - 1)),
        };

        parent.children.push(childNode.id);
        nodes.push(childNode);
        subdivide(childNode, levels - 1);
      }
    };

    subdivide(rootNode, maxDepth);

    return { root: rootNode, nodes };
  }
}
