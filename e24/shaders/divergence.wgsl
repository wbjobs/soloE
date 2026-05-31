@group(0) @binding(0) var<uniform> texelSize: vec2<f32>;
@group(0) @binding(1) var velocity: texture_2d<f32>;
@group(0) @binding(2) var divergence: texture_storage_2d<r16float, write>;

fn sampleVelocity(tex: texture_2d<f32>, pos: vec2<i32>, dims: vec2<u32>) -> vec2<f32> {
  let clampedPos = clamp(pos, vec2<i32>(0), vec2<i32>(dims) - 1);
  return textureLoad(tex, clampedPos, 0).xy;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(velocity);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  
  let pos = vec2<i32>(id.xy);
  let L = sampleVelocity(velocity, pos + vec2<i32>(-1, 0), dims).x;
  let R = sampleVelocity(velocity, pos + vec2<i32>(1, 0), dims).x;
  let T = sampleVelocity(velocity, pos + vec2<i32>(0, -1), dims).y;
  let B = sampleVelocity(velocity, pos + vec2<i32>(0, 1), dims).y;
  
  let div = 0.5 * ((R - L) + (B - T));
  textureStore(divergence, pos, vec4<f32>(div, 0.0, 0.0, 0.0));
}
