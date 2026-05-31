export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface BVHNode {
  minX: number;
  minY: number;
  minZ: number;
  leftChild: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  rightChild: number;
}

export interface VoxelData {
  width: number;
  height: number;
  depth: number;
  data: Uint8Array;
}

export interface Camera {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
}

export interface PerformanceMetrics {
  bvhBuildTime: number;
  avgTraversalCount: number;
  fps: number;
  frameTime: number;
}

export interface RenderSettings {
  raysPerPixel: number;
  maxBounces: number;
  showBVH: boolean;
  bvhLevel: number;
}
