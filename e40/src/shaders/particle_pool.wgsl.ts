export const PARTICLE_POOL_SHADER = `
struct Particle {
  position: vec3f,
  velocity: vec3f,
  lifetime: f32,
  maxLifetime: f32,
  size: f32,
  activity: f32,
  density: f32,
  pad: f32
}

struct EmitRequest {
  position: vec3f,
  direction: vec3f,
  strength: f32,
  count: u32
}

struct PoolUniforms {
  maxParticles: u32,
  maxDistance: f32,
  cameraPos: vec3f,
  dt: f32,
  windX: f32,
  windY: f32,
  windZ: f32,
  dissipation: f32,
  activeCount: atomic<u32>
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> freeList: array<u32>;
@group(0) @binding(2) var<uniform> uniforms: PoolUniforms;
@group(0) @binding(3) var<storage, read> emitRequests: array<EmitRequest>;
@group(0) @binding(4) var<storage, read_write> freeListHead: atomic<u32>;

const PARTICLE_SIZE: u32 = 48u;

fn sampleVelocityGrid(pos: vec3f, gridSize: u32) -> vec3f {
  let gridPos = clamp(pos * 0.5 + 0.5, 0.0, 1.0) * f32(gridSize);
  let x0 = u32(floor(gridPos.x));
  let y0 = u32(floor(gridPos.y));
  let z0 = u32(floor(gridPos.z));
  return vec3f(0.0);
}

@compute @workgroup_size(256)
fn initParticlePool(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= uniforms.maxParticles) { return; }
  
  particles[index].position = vec3f(0.0, -1000.0, 0.0);
  particles[index].velocity = vec3f(0.0);
  particles[index].lifetime = 0.0;
  particles[index].maxLifetime = 0.0;
  particles[index].size = 0.005;
  particles[index].activity = 0.0;
  particles[index].density = 0.0;
  
  freeList[index] = uniforms.maxParticles - 1u - index;
}

@compute @workgroup_size(256)
fn updateParticles(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= uniforms.maxParticles) { return; }
  
  var particle = particles[index];
  
  if (particle.lifetime <= 0.0) {
    if (particle.activity > 0.5) {
      let freeIndex = atomicAdd(&freeListHead, 1u) % uniforms.maxParticles;
      freeList[freeIndex] = index;
      particle.activity = 0.0;
    }
    particles[index] = particle;
    return;
  }
  
  let toCamera = uniforms.cameraPos - particle.position;
  let distance = length(toCamera);
  
  if (distance > uniforms.maxDistance * 1.5) {
    particle.lifetime = 0.0;
    particle.activity = 0.0;
    let freeIndex = atomicAdd(&freeListHead, 1u) % uniforms.maxParticles;
    freeList[freeIndex] = index;
    particles[index] = particle;
    return;
  }
  
  var activityFactor = 1.0;
  if (distance > uniforms.maxDistance * 0.7) {
    activityFactor = 1.0 - (distance - uniforms.maxDistance * 0.7) / (uniforms.maxDistance * 0.8);
    activityFactor = clamp(activityFactor, 0.1, 1.0);
  }
  
  let wind = vec3f(uniforms.windX, uniforms.windY, uniforms.windZ) * 0.5;
  particle.velocity = particle.velocity * 0.98 + wind * uniforms.dt;
  particle.velocity += vec3f(0.0, 0.05, 0.0) * uniforms.dt;
  
  particle.position += particle.velocity * uniforms.dt * activityFactor;
  particle.lifetime -= uniforms.dt * (1.0 + (1.0 - activityFactor) * 2.0);
  particle.activity = activityFactor * smoothstep(0.0, 0.3, particle.lifetime / particle.maxLifetime);
  particle.density = particle.activity * smoothstep(0.0, 0.5, particle.lifetime / particle.maxLifetime);
  
  let boundary = 0.95;
  if (any(particle.position > vec3f(boundary)) || any(particle.position < vec3f(-boundary))) {
    particle.lifetime -= uniforms.dt * 3.0;
  }
  
  particles[index] = particle;
  
  if (particle.lifetime > 0.0 && particle.activity > 0.1) {
    atomicAdd(&uniforms.activeCount, 1u);
  }
}

@compute @workgroup_size(64)
fn emitParticles(@builtin(global_invocation_id) id: vec3u) {
  let requestIndex = id.x;
  if (requestIndex >= 8u) { return; }
  
  let request = emitRequests[requestIndex];
  if (request.count == 0u || request.strength <= 0.0) { return; }
  
  for (var i: u32 = 0u; i < request.count; i++) {
    var freeIdx = atomicSub(&freeListHead, 1u);
    if (freeIdx <= 0u) {
      atomicAdd(&freeListHead, 1u);
      break;
    }
    freeIdx = freeIdx % uniforms.maxParticles;
    
    let particleIdx = freeList[freeIdx];
    if (particleIdx >= uniforms.maxParticles) { continue; }
    
    let random1 = fract(sin(f32(particleIdx) * 12.9898 + f32(i) * 78.233) * 43758.5453);
    let random2 = fract(sin(f32(particleIdx) * 43.758 + f32(i) * 92.321) * 23421.632);
    let random3 = fract(sin(f32(particleIdx) * 76.231 + f32(i) * 45.123) * 76234.123);
    
    let offset = vec3f(random1, random2, random3) - vec3f(0.5);
    let spawnPos = request.position + offset * request.strength * 0.1;
    
    var particle: Particle;
    particle.position = spawnPos;
    particle.velocity = request.direction + offset * request.strength * 2.0;
    particle.lifetime = 2.0 + random1 * 3.0;
    particle.maxLifetime = particle.lifetime;
    particle.size = 0.008 + random1 * 0.012;
    particle.activity = 1.0;
    particle.density = request.strength * 0.5;
    
    particles[particleIdx] = particle;
  }
}
`;

export const PARTICLE_RENDER_OPTIMIZED_SHADER = `
struct Particle {
  position: vec3f,
  velocity: vec3f,
  lifetime: f32,
  maxLifetime: f32,
  size: f32,
  activity: f32,
  density: f32,
  pad: f32
}

struct RenderUniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  particleScale: f32,
  maxDistance: f32,
  time: f32,
  pad: vec3f
}

@group(0) @binding(0) var<uniform> uniforms: RenderUniforms;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) uv: vec2f,
  @location(2) centerDist: f32
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var out: VertexOutput;
  
  let particle = particles[instanceIndex];
  
  if (particle.lifetime <= 0.0 || particle.activity < 0.05) {
    out.position = vec4f(0.0, 0.0, -1000.0, 1.0);
    out.color = vec4f(0.0);
    return out;
  }
  
  let toCamera = uniforms.cameraPos - particle.position;
  let distance = length(toCamera);
  
  if (distance > uniforms.maxDistance) {
    out.position = vec4f(0.0, 0.0, -1000.0, 1.0);
    out.color = vec4f(0.0);
    return out;
  }
  
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
  
  let worldPos = particle.position;
  let viewDir = normalize(toCamera);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), viewDir));
  let up = cross(viewDir, right);
  
  let distFade = 1.0 - smoothstep(uniforms.maxDistance * 0.6, uniforms.maxDistance, distance);
  let size = particle.size * uniforms.particleScale * distFade * (0.5 + particle.density);
  
  let vertexPos = worldPos + right * corner.x * size + up * corner.y * size;
  out.position = uniforms.viewProj * vec4f(vertexPos, 1.0);
  
  let speed = length(particle.velocity);
  var color = mix(
    vec3f(0.3, 0.5, 0.85),
    vec3f(1.0, 0.65, 0.3),
    clamp(speed * 3.0, 0.0, 1.0)
  );
  color = mix(color, vec3f(1.0, 0.95, 0.85), clamp(particle.density, 0.0, 1.0));
  
  let lifeFade = smoothstep(0.0, 0.2, particle.lifetime / particle.maxLifetime);
  let alpha = particle.activity * distFade * lifeFade * 0.7;
  
  out.color = vec4f(color, alpha);
  out.centerDist = length(corner);
  
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  if (in.color.a <= 0.01) { discard; }
  
  let dist = in.centerDist;
  let alpha = 1.0 - smoothstep(0.3, 1.0, dist);
  let glow = exp(-dist * dist * 8.0) * 0.3;
  
  var finalColor = in.color.rgb * (1.0 + glow);
  var finalAlpha = in.color.a * alpha * (1.0 + glow * 0.5);
  
  return vec4f(finalColor, finalAlpha);
}
`;

export const CUBE_RENDER_SHADER = `
struct RenderUniforms {
  viewProj: mat4x4f,
  cameraPos: vec3f,
  particleScale: f32,
  maxDistance: f32,
  time: f32,
  pad: vec3f
}

@group(0) @binding(0) var<uniform> uniforms: RenderUniforms;

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

