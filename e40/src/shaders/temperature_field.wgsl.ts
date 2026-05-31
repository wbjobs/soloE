export const TEMPERATURE_FIELD_SHADER = `
struct HeatSource {
  position: vec3f,
  radius: f32,
  temperature: f32,
  lifetime: f32,
  maxLifetime: f32
}

struct TemperatureUniforms {
  gridSize: u32,
  dt: f32,
  diffusionRate: f32,
  buoyancyStrength: f32,
  coolingRate: f32,
  numSources: u32,
  pad: vec2f
}

const GRID_SIZE: u32 = 32;
const GRID_CELLS: u32 = GRID_SIZE * GRID_SIZE * GRID_SIZE;

@group(0) @binding(0) var<storage, read_write> temperature: array<f32>;
@group(0) @binding(1) var<storage, read_write> velocity: array<vec3f>;
@group(0) @binding(2) var<uniform> uniforms: TemperatureUniforms;
@group(0) @binding(3) var<storage, read> heatSources: array<HeatSource>;

fn idx(x: u32, y: u32, z: u32) -> u32 {
  return x + y * GRID_SIZE + z * GRID_SIZE * GRID_SIZE;
}

fn clampIdx(v: u32) -> u32 {
  return clamp(v, 0u, GRID_SIZE - 1u);
}

fn getTemp(x: u32, y: u32, z: u32) -> f32 {
  return temperature[idx(clampIdx(x), clampIdx(y), clampIdx(z))];
}

@compute @workgroup_size(4, 4, 4)
fn updateHeatSources(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(GRID_SIZE))) { return; }
  
  let i = idx(id.x, id.y, id.z);
  let cellPos = vec3f(f32(id.x), f32(id.y), f32(id.z)) / f32(GRID_SIZE);
  let worldPos = (cellPos - 0.5) * 2.0;
  
  for (var s: u32 = 0u; s < uniforms.numSources; s++) {
    let source = heatSources[s];
    if (source.lifetime <= 0.0) { continue; }
    
    let dist = distance(worldPos, source.position);
    if (dist < source.radius) {
      let falloff = 1.0 - dist / source.radius;
      let heat = source.temperature * falloff * falloff * uniforms.dt;
      temperature[i] += heat * 0.5;
    }
  }
}

@compute @workgroup_size(4, 4, 4)
fn diffuseTemperature(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(GRID_SIZE))) { return; }
  
  let i = idx(id.x, id.y, id.z);
  
  let neighborSum = 
    getTemp(id.x - 1u, id.y, id.z) +
    getTemp(id.x + 1u, id.y, id.z) +
    getTemp(id.x, id.y - 1u, id.z) +
    getTemp(id.x, id.y + 1u, id.z) +
    getTemp(id.x, id.y, id.z - 1u) +
    getTemp(id.x, id.y, id.z + 1u);
  
  let alpha = uniforms.dt * uniforms.diffusionRate;
  temperature[i] = (temperature[i] + alpha * neighborSum) / (1.0 + 6.0 * alpha);
}

@compute @workgroup_size(4, 4, 4)
fn applyBuoyancy(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(GRID_SIZE))) { return; }
  
  let i = idx(id.x, id.y, id.z);
  let temp = temperature[i];
  
  if (temp > 0.1) {
    let buoyancy = vec3f(0.0, temp * uniforms.buoyancyStrength * uniforms.dt, 0.0);
    velocity[i] += buoyancy;
    
    let horizontalSpread = vec3f(
      (f32(id.x % 2u) - 0.5) * temp * 0.1,
      0.0,
      (f32(id.z % 2u) - 0.5) * temp * 0.1
    );
    velocity[i] += horizontalSpread * uniforms.dt;
  }
}

@compute @workgroup_size(4, 4, 4)
fn coolDown(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(GRID_SIZE))) { return; }
  
  let i = idx(id.x, id.y, id.z);
  temperature[i] *= 1.0 - uniforms.coolingRate * uniforms.dt;
  temperature[i] = max(temperature[i], 0.0);
}

fn sampleTemperature(worldPos: vec3f) -> f32 {
  let gridPos = (worldPos * 0.5 + 0.5) * f32(GRID_SIZE);
  let x0 = u32(floor(gridPos.x));
  let y0 = u32(floor(gridPos.y));
  let z0 = u32(floor(gridPos.z));
  
  let fx = fract(gridPos.x);
  let fy = fract(gridPos.y);
  let fz = fract(gridPos.z);
  
  let t000 = getTemp(x0, y0, z0);
  let t100 = getTemp(x0 + 1u, y0, z0);
  let t010 = getTemp(x0, y0 + 1u, z0);
  let t110 = getTemp(x0 + 1u, y0 + 1u, z0);
  let t001 = getTemp(x0, y0, z0 + 1u);
  let t101 = getTemp(x0 + 1u, y0, z0 + 1u);
  let t011 = getTemp(x0, y0 + 1u, z0 + 1u);
  let t111 = getTemp(x0 + 1u, y0 + 1u, z0 + 1u);
  
  let t00 = mix(t000, t100, fx);
  let t10 = mix(t010, t110, fx);
  let t01 = mix(t001, t101, fx);
  let t11 = mix(t011, t111, fx);
  
  let t0 = mix(t00, t01, fz);
  let t1 = mix(t10, t11, fz);
  
  return mix(t0, t1, fy);
}
`;

export const HEAT_SOURCE_RENDER_SHADER = `
struct RenderUniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  time: f32,
  pad: f32
}

struct HeatSource {
  position: vec3f,
  radius: f32,
  temperature: f32,
  lifetime: f32,
  maxLifetime: f32
}

@group(0) @binding(0) var<uniform> uniforms: RenderUniforms;
@group(0) @binding(1) var<storage, read> heatSources: array<HeatSource>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) localPos: vec3f
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var out: VertexOutput;
  
  let source = heatSources[instanceIndex];
  if (source.lifetime <= 0.0) {
    out.position = vec4f(0.0, 0.0, -1000.0, 1.0);
    return out;
  }
  
  let phi = f32(vertexIndex % 16u) / 16.0 * 3.14159 * 2.0;
  let theta = f32(vertexIndex / 16u) / 12.0 * 3.14159;
  
  let spherePos = vec3f(
    sin(theta) * cos(phi),
    sin(theta) * sin(phi),
    cos(theta)
  );
  
  let pulse = 1.0 + 0.1 * sin(uniforms.time * 3.0);
  let worldPos = source.position + spherePos * source.radius * pulse;
  out.position = uniforms.viewProj * vec4f(worldPos, 1.0);
  out.localPos = spherePos;
  
  let lifeRatio = source.lifetime / source.maxLifetime;
  var color = mix(
    vec3f(1.0, 0.3, 0.0),
    vec3f(1.0, 0.9, 0.2),
    clamp(source.temperature / 5.0, 0.0, 1.0)
  );
  
  out.color = vec4f(color, lifeRatio * 0.6);
  
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let dist = length(in.localPos);
  let edge = 1.0 - smoothstep(0.7, 1.0, dist);
  let glow = exp(-dist * dist * 4.0) * 0.5;
  
  return vec4f(in.color.rgb * (1.0 + glow), in.color.a * (edge + glow));
}
`;
