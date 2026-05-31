struct Particle {
  pos: vec2f,
  vel: vec2f,
}

struct Uniforms {
  mouseX: f32,
  mouseY: f32,
  mouseDX: f32,
  mouseDY: f32,
  mouseActive: f32,
  canvasWidth: f32,
  canvasHeight: f32,
  viscosity: f32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

const GRAVITY: vec2f = vec2f(0.0, 9.8 * 15.0);
const DT: f32 = 0.016;
const RESTITUTION: f32 = 0.3;
const MOUSE_RADIUS: f32 = 100.0;
const MOUSE_FORCE: f32 = 600.0;
const PARTICLE_RADIUS: f32 = 6.0;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) global_id: vec3u) {
  let idx = global_id.x;
  if (idx >= arrayLength(&particles)) {
    return;
  }

  var p = particles[idx];

  p.vel += GRAVITY * DT;
  p.vel *= uniforms.viscosity;

  if (uniforms.mouseActive > 0.5) {
    let mousePos = vec2f(uniforms.mouseX, uniforms.mouseY);
    let diff = mousePos - p.pos;
    let dist = length(diff);
    if (dist < MOUSE_RADIUS && dist > 0.0) {
      let force = normalize(diff) * MOUSE_FORCE * (1.0 - dist / MOUSE_RADIUS);
      let mouseVel = vec2f(uniforms.mouseDX, uniforms.mouseDY) / DT;
      p.vel += force * DT + mouseVel * 0.5;
    }
  }

  p.pos += p.vel * DT;

  let radius = PARTICLE_RADIUS;
  if (p.pos.x < radius) {
    p.pos.x = radius;
    p.vel.x = -p.vel.x * RESTITUTION;
  }
  if (p.pos.x > uniforms.canvasWidth - radius) {
    p.pos.x = uniforms.canvasWidth - radius;
    p.vel.x = -p.vel.x * RESTITUTION;
  }
  if (p.pos.y < radius) {
    p.pos.y = radius;
    p.vel.y = -p.vel.y * RESTITUTION;
  }
  if (p.pos.y > uniforms.canvasHeight - radius) {
    p.pos.y = uniforms.canvasHeight - radius;
    p.vel.y = -p.vel.y * RESTITUTION;
  }

  particles[idx] = p;
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
}

const QUAD_VERTS = array<vec2f, 6>(
  vec2f(-1.0, -1.0),
  vec2f( 1.0, -1.0),
  vec2f(-1.0,  1.0),
  vec2f(-1.0,  1.0),
  vec2f( 1.0, -1.0),
  vec2f( 1.0,  1.0)
);

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) pos: vec2f,
  @location(1) vel: vec2f
) -> VertexOutput {
  var output: VertexOutput;
  
  let corner = QUAD_VERTS[vertexIndex];
  output.uv = corner * 0.5 + 0.5;
  
  let scale = PARTICLE_RADIUS;
  let worldPos = pos + corner * scale;
  
  let ndcX = (worldPos.x / uniforms.canvasWidth) * 2.0 - 1.0;
  let ndcY = (worldPos.y / uniforms.canvasHeight) * -2.0 + 1.0;
  
  output.position = vec4f(ndcX, ndcY, 0.0, 1.0);
  
  let speed = length(vel);
  let colorSpeed = clamp(speed / 400.0, 0.0, 1.0);
  output.color = vec4f(
    0.1 + colorSpeed * 0.5,
    0.3 + colorSpeed * 0.4,
    0.9 - colorSpeed * 0.2,
    1.0
  );
  
  return output;
}

@fragment
fn fragmentMain(
  @location(0) uv: vec2f,
  @location(1) color: vec4f
) -> @location(0) vec4f {
  let center = vec2f(0.5, 0.5);
  let dist = length(uv - center);
  
  if (dist > 0.5) {
    discard;
  }
  
  let alpha = 1.0 - smoothstep(0.35, 0.5, dist);
  return vec4f(color.rgb, alpha);
}
