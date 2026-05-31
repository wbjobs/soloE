struct Particle {
  position: vec2<f32>,
  velocity: vec2<f32>,
  life: f32,
  maxLife: f32,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var velocityTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> dt: f32;
@group(0) @binding(3) var<uniform> time: f32;
@group(0) @binding(4) var<uniform> texelSize: vec2<f32>;

fn sampleVelocity(uv: vec2<f32>) -> vec2<f32> {
  let dims = vec2<f32>(textureDimensions(velocityTexture));
  let clampedUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  let coords = vec2<i32>(clampedUv * dims);
  return textureLoad(velocityTexture, coords, 0).xy;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let particleIndex = id.x;
  if (particleIndex >= arrayLength(&particles)) {
    return;
  }
  
  var p = particles[particleIndex];
  
  p.life -= dt;
  
  if (p.life <= 0.0) {
    let angle = fract(f32(particleIndex) * 0.61803398875 + time * 0.1) * 6.283185307;
    let radius = fract(f32(particleIndex) * 0.8543 + time * 0.05) * 0.3 + 0.1;
    p.position = vec2<f32>(0.5, 0.5) + vec2<f32>(cos(angle), sin(angle)) * radius;
    p.velocity = vec2<f32>(0.0, 0.0);
    p.life = p.maxLife;
  }
  
  let fluidVelocity = sampleVelocity(p.position);
  p.velocity = mix(p.velocity, fluidVelocity * 2.0, 0.1);
  p.position += p.velocity * dt;
  
  let bounce = 0.3;
  if (p.position.x < 0.0) {
    p.position.x = 0.0;
    p.velocity.x = -p.velocity.x * bounce;
  }
  if (p.position.x > 1.0) {
    p.position.x = 1.0;
    p.velocity.x = -p.velocity.x * bounce;
  }
  if (p.position.y < 0.0) {
    p.position.y = 0.0;
    p.velocity.y = -p.velocity.y * bounce;
  }
  if (p.position.y > 1.0) {
    p.position.y = 1.0;
    p.velocity.y = -p.velocity.y * bounce;
  }
  
  particles[particleIndex] = p;
}
