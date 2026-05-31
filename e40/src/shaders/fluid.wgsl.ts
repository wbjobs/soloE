export const FLUID_COMPUTE_SHADER = `
@group(0) @binding(0) var<storage, read_write> velocity: array<vec3f>;
@group(0) @binding(1) var<storage, read_write> density: array<f32>;
@group(0) @binding(2) var<storage, read_write> pressure: array<f32>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read> emitters: array<Emitter>;

struct Params {
  gridSize: u32,
  dt: f32,
  diffusion: f32,
  dissipation: f32,
  windX: f32,
  windY: f32,
  windZ: f32,
  numEmitters: u32,
  pad: vec2f
}

struct Emitter {
  pos: vec3f,
  radius: f32,
  strength: f32,
  lifetime: f32
}

const GRID_SIZE: u32 = 64;
const GRID_CELLS: u32 = GRID_SIZE * GRID_SIZE * GRID_SIZE;

fn idx(x: u32, y: u32, z: u32) -> u32 {
  return x + y * GRID_SIZE + z * GRID_SIZE * GRID_SIZE;
}

fn clampIdx(v: u32) -> u32 {
  return clamp(v, 0u, GRID_SIZE - 1u);
}

fn getVel(x: u32, y: u32, z: u32) -> vec3f {
  return velocity[idx(clampIdx(x), clampIdx(y), clampIdx(z))];
}

fn getDens(x: u32, y: u32, z: u32) -> f32 {
  return density[idx(clampIdx(x), clampIdx(y), clampIdx(z))];
}

@compute @workgroup_size(8, 8, 8)
fn advection(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(GRID_SIZE))) { return; }
  
  let i = idx(id.x, id.y, id.z);
  let pos = vec3f(f32(id.x), f32(id.y), f32(id.z));
  let vel = velocity[i];
  
  let wind = vec3f(params.windX, params.windY, params.windZ);
  let totalVel = vel + wind * 0.1;
  
  let prevPos = pos - totalVel * params.dt * 10.0;
  
  let x0 = u32(floor(prevPos.x));
  let y0 = u32(floor(prevPos.y));
  let z0 = u32(floor(prevPos.z));
  
  let fx = prevPos.x - floor(prevPos.x);
  let fy = prevPos.y - floor(prevPos.y);
  let fz = prevPos.z - floor(prevPos.z);
  
  let v000 = getVel(x0, y0, z0);
  let v100 = getVel(x0 + 1u, y0, z0);
  let v010 = getVel(x0, y0 + 1u, z0);
  let v110 = getVel(x0 + 1u, y0 + 1u, z0);
  let v001 = getVel(x0, y0, z0 + 1u);
  let v101 = getVel(x0 + 1u, y0, z0 + 1u);
  let v011 = getVel(x0, y0 + 1u, z0 + 1u);
  let v111 = getVel(x0 + 1u, y0 + 1u, z0 + 1u);
  
  let v00 = mix(v000, v100, fx);
  let v10 = mix(v010, v110, fx);
  let v01 = mix(v001, v101, fx);
  let v11 = mix(v011, v111, fx);
  
  let v0 = mix(v00, v01, fz);
  let v1 = mix(v10, v11, fz);
  
  velocity[i] = mix(v0, v1, fy);
  
  let d000 = getDens(x0, y0, z0);
  let d100 = getDens(x0 + 1u, y0, z0);
  let d010 = getDens(x0, y0 + 1u, z0);
  let d110 = getDens(x0 + 1u, y0 + 1u, z0);
  let d001 = getDens(x0, y0, z0 + 1u);
  let d101 = getDens(x0 + 1u, y0, z0 + 1u);
  let d011 = getDens(x0, y0 + 1u, z0 + 1u);
  let d111 = getDens(x0 + 1u, y0 + 1u, z0 + 1u);
  
  let d00 = mix(d000, d100, fx);
  let d10 = mix(d010, d110, fx);
  let d01 = mix(d001, d101, fx);
  let d11 = mix(d011, d111, fx);
  
  let d0 = mix(d00, d01, fz);
  let d1 = mix(d10, d11, fy);
  
  density[i] = mix(d0, d1, fy) * (1.0 - params.dissipation);
}

@compute @workgroup_size(8, 8, 8)
fn diffusion(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(GRID_SIZE))) { return; }
  
  let i = idx(id.x, id.y, id.z);
  
  let alpha = params.dt * params.diffusion * 100.0;
  
  let neighborSum = 
    getVel(id.x - 1u, id.y, id.z) +
    getVel(id.x + 1u, id.y, id.z) +
    getVel(id.x, id.y - 1u, id.z) +
    getVel(id.x, id.y + 1u, id.z) +
    getVel(id.x, id.y, id.z - 1u) +
    getVel(id.x, id.y, id.z + 1u);
  
  velocity[i] = (velocity[i] + alpha * neighborSum) / (1.0 + 6.0 * alpha);
}

@compute @workgroup_size(8, 8, 8)
fn divergence(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(GRID_SIZE))) { return; }
  
  let i = idx(id.x, id.y, id.z);
  
  let dx = (getVel(id.x + 1u, id.y, id.z).x - getVel(id.x - 1u, id.y, id.z).x) * 0.5;
  let dy = (getVel(id.x, id.y + 1u, id.z).y - getVel(id.x, id.y - 1u, id.z).y) * 0.5;
  let dz = (getVel(id.x, id.y, id.z + 1u).z - getVel(id.x, id.y, id.z - 1u).z) * 0.5;
  
  pressure[i] = dx + dy + dz;
}

@compute @workgroup_size(8, 8, 8)
fn pressureSolve(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(GRID_SIZE))) { return; }
  
  let i = idx(id.x, id.y, id.z);
  
  let neighborSum = 
    pressure[idx(clampIdx(id.x - 1u), id.y, id.z)] +
    pressure[idx(clampIdx(id.x + 1u), id.y, id.z)] +
    pressure[idx(id.x, clampIdx(id.y - 1u), id.z)] +
    pressure[idx(id.x, clampIdx(id.y + 1u), id.z)] +
    pressure[idx(id.x, id.y, clampIdx(id.z - 1u))] +
    pressure[idx(id.x, id.y, clampIdx(id.z + 1u))];
  
  pressure[i] = (pressure[i] + neighborSum) / 6.0;
}

@compute @workgroup_size(8, 8, 8)
fn gradientSubtract(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(GRID_SIZE))) { return; }
  
  let i = idx(id.x, id.y, id.z);
  
  let dx = pressure[idx(clampIdx(id.x + 1u), id.y, id.z)] - pressure[idx(clampIdx(id.x - 1u), id.y, id.z)];
  let dy = pressure[idx(id.x, clampIdx(id.y + 1u), id.z)] - pressure[idx(id.x, clampIdx(id.y - 1u), id.z)];
  let dz = pressure[idx(id.x, id.y, clampIdx(id.z + 1u))] - pressure[idx(id.x, id.y, clampIdx(id.z - 1u))];
  
  velocity[i] -= vec3f(dx, dy, dz) * 0.5;
}

@compute @workgroup_size(8, 8, 8)
fn emission(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= vec3u(GRID_SIZE))) { return; }
  
  let i = idx(id.x, id.y, id.z);
  let pos = vec3f(f32(id.x), f32(id.y), f32(id.z));
  
  for (var e: u32 = 0u; e < params.numEmitters; e++) {
    let emitter = emitters[e];
    if (emitter.lifetime <= 0.0) { continue; }
    
    let dist = distance(pos, emitter.pos * vec3f(f32(GRID_SIZE)));
    if (dist < emitter.radius) {
      let falloff = 1.0 - dist / emitter.radius;
      density[i] += emitter.strength * falloff * falloff * params.dt;
      
      let dir = normalize(pos - emitter.pos * vec3f(f32(GRID_SIZE)) + vec3f(0.01));
      velocity[i] += dir * emitter.strength * falloff * params.dt * 5.0;
    }
  }
}
`;

export const PARTICLE_RENDER_SHADER = `
struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  particleSize: f32,
  gridSize: f32,
  time: f32,
  pad: vec3f
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> density: array<f32>;
@group(0) @binding(2) var<storage, read> velocity: array<vec3f>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) uv: vec2f
}

const GRID_SIZE: u32 = 64;
const GRID_CELLS: u32 = GRID_SIZE * GRID_SIZE * GRID_SIZE;

fn idx(x: u32, y: u32, z: u32) -> u32 {
  return x + y * GRID_SIZE + z * GRID_SIZE * GRID_SIZE;
}

fn hash(p: vec3u) -> f32 {
  var h = p.x * 1073741827u + p.y * 19349663u + p.z * 83492791u;
  h = (h << 13u) ^ h;
  return 1.0 - f32((h * (h * h * 15731u + 789221u) + 1376312589u) & 0x7fffffffu) / 1073741824.0;
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var out: VertexOutput;
  
  let cellX = instanceIndex % GRID_SIZE;
  let cellY = (instanceIndex / GRID_SIZE) % GRID_SIZE;
  let cellZ = instanceIndex / (GRID_SIZE * GRID_SIZE);
  
  let i = idx(cellX, cellY, cellZ);
  let dens = density[i];
  
  let offset = vec3f(
    hash(vec3u(cellX, cellY, cellZ)),
    hash(vec3u(cellX + 100u, cellY, cellZ)),
    hash(vec3u(cellX, cellY + 100u, cellZ))
  ) * 0.5;
  
  var cellPos = (vec3f(f32(cellX), f32(cellY), f32(cellZ)) + offset) / f32(GRID_SIZE);
  cellPos = cellPos * 2.0 - 1.0;
  
  let vel = velocity[i];
  cellPos += vel * 0.02;
  
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f( 1.0,  1.0),
    vec2f(-1.0, -1.0),
    vec2f( 1.0,  1.0),
    vec2f(-1.0,  1.0)
  );
  
  let corner = corners[vertexIndex];
  out.uv = corner * 0.5 + 0.5;
  
  let worldPos = cellPos * 0.8;
  let viewDir = normalize(uniforms.cameraPos - worldPos);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), viewDir));
  let up = cross(viewDir, right);
  
  let size = uniforms.particleSize * (0.5 + dens * 2.0);
  let vertexPos = worldPos + right * corner.x * size + up * corner.y * size;
  
  out.position = uniforms.viewProj * vec4f(vertexPos, 1.0);
  
  let speed = length(vel);
  var color = mix(
    vec3f(0.3, 0.5, 0.8),
    vec3f(1.0, 0.6, 0.3),
    clamp(speed * 2.0, 0.0, 1.0)
  );
  color = mix(color, vec3f(1.0, 1.0, 0.8), clamp(dens * 0.5, 0.0, 1.0));
  
  let alpha = clamp(dens * 3.0, 0.0, 1.0);
  out.color = vec4f(color, alpha * 0.6);
  
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let dist = length(in.uv - vec2f(0.5));
  if (dist > 0.5) { discard; }
  
  let alpha = 1.0 - smoothstep(0.3, 0.5, dist);
  return vec4f(in.color.rgb, in.color.a * alpha);
}
`;

export const CUBE_RENDER_SHADER = `
struct Uniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  pad: vec4f
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var out: VertexOutput;
  
  let cubeVertices = array<vec3f, 24>(
    vec3f(-1.0, -1.0, -1.0),
    vec3f( 1.0, -1.0, -1.0),
    vec3f( 1.0,  1.0, -1.0),
    vec3f(-1.0,  1.0, -1.0),
    vec3f(-1.0, -1.0,  1.0),
    vec3f( 1.0, -1.0,  1.0),
    vec3f( 1.0,  1.0,  1.0),
    vec3f(-1.0,  1.0,  1.0)
  );
  
  let cubeIndices = array<u32, 24>(
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7
  );
  
  let pos = cubeVertices[cubeIndices[vertexIndex]] * 0.8;
  out.position = uniforms.viewProj * vec4f(pos, 1.0);
  out.color = vec4f(0.2, 0.3, 0.4, 0.5);
  
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  return in.color;
}
`;
