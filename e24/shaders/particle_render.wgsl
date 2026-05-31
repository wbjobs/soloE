struct Particle {
  position: vec2<f32>,
  velocity: vec2<f32>,
  life: f32,
  maxLife: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) life: f32,
  @location(2) speed: f32,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> resolution: vec2<f32>;

@vertex
fn vertex_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var out: VertexOutput;
  
  let p = particles[instanceIndex];
  
  let positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>(-1.0,  1.0)
  );
  
  let pos = positions[vertexIndex];
  let particleSize = 3.0;
  
  let screenPos = p.position * 2.0 - 1.0;
  let pixelPos = screenPos * vec2<f32>(1.0, -1.0) + pos * particleSize / resolution;
  
  out.position = vec4<f32>(pixelPos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  out.life = p.life / p.maxLife;
  out.speed = length(p.velocity);
  
  return out;
}

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let dist = length(in.uv - vec2<f32>(0.5));
  let alpha = smoothstep(0.5, 0.0, dist);
  
  let speedColor = vec3<f32>(0.0, 0.8, 1.0);
  let lifeColor = vec3<f32>(1.0, 0.4, 0.8);
  let color = mix(speedColor, lifeColor, clamp(in.speed * 5.0, 0.0, 1.0));
  
  let finalAlpha = alpha * in.life;
  return vec4<f32>(color, finalAlpha * 0.8);
}
