export interface SimulationConfig {
  resolution: [number, number];
  dt: number;
  viscosity: number;
  diffusion: number;
  pressureIterations: number;
  mouseForce: number;
  mouseRadius: number;
  dissipation: number;
}

export interface MouseState {
  position: [number, number];
  delta: [number, number];
  isDown: boolean;
  color: [number, number, number];
}

export interface FluidResources {
  velocity: [GPUTexture, GPUTexture];
  density: [GPUTexture, GPUTexture];
  pressure: [GPUTexture, GPUTexture];
  divergence: GPUTexture;
}

export interface PipelineCollection {
  advection: GPUComputePipeline;
  divergence: GPUComputePipeline;
  pressure: GPUComputePipeline;
  gradient: GPUComputePipeline;
  mouseInput: GPUComputePipeline;
  render: GPURenderPipeline;
}

export interface BindGroupCollection {
  advectionVelocity: [GPUBindGroup, GPUBindGroup];
  advectionDensity: [GPUBindGroup, GPUBindGroup];
  divergence: GPUBindGroup;
  pressure: [GPUBindGroup, GPUBindGroup];
  gradient: GPUBindGroup;
  mouseInputVelocity: GPUBindGroup;
  mouseInputDensity: GPUBindGroup;
  render: GPUBindGroup;
}
