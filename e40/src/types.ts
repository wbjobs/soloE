export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface FluidParams {
  windX: number;
  windY: number;
  windZ: number;
  diffusion: number;
  dissipation: number;
  emissionStrength: number;
}

export interface Emitter {
  position: Vec3;
  radius: number;
  strength: number;
  lifetime: number;
}

export interface FrameStats {
  fps: number;
  gpuTime: number;
  particleCount: number;
}

export const GRID_SIZE = 64;
export const GRID_CELLS = GRID_SIZE * GRID_SIZE * GRID_SIZE;
export const PARTICLE_COUNT = 65536;
export const WORKGROUP_SIZE = 8;
