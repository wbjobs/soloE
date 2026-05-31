@group(0) @binding(0) var<uniform> texelSize: vec2<f32>;
@group(0) @binding(1) var pressure: texture_2d<f32>;
@group(0) @binding(2) var velocity: texture_2d<f32>;
@group(0) @binding(3) var outputVelocity: texture_storage_2d<rg16float, write>;

fn samplePressure(tex: texture_2d<f32>, pos: vec2<i32>, dims: vec2<u32>) -> f32 {
  let clampedPos = clamp(pos, vec2<i32>(0), vec2<i32>(dims) - 1);
  return textureLoad(tex, clampedPos, 0).x;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(pressure);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  
  let pos = vec2<i32>(id.xy);
  
  let isOnBoundary = pos.x == 0 || pos.x == vec2<i32>(dims).x - 1 || 
                     pos.y == 0 || pos.y == vec2<i32>(dims).y - 1;
  
  if (isOnBoundary) {
    textureStore(outputVelocity, pos, vec4<f32>(0.0, 0.0, 0.0, 0.0));
    return;
  }
  
  let L = samplePressure(pressure, pos + vec2<i32>(-1, 0), dims);
  let R = samplePressure(pressure, pos + vec2<i32>(1, 0), dims);
  let T = samplePressure(pressure, pos + vec2<i32>(0, -1), dims);
  let B = samplePressure(pressure, pos + vec2<i32>(0, 1), dims);
  
  let grad = 0.5 * vec2<f32>(R - L, B - T);
  let vel = textureLoad(velocity, pos, 0).xy - grad;
  
  textureStore(outputVelocity, pos, vec4<f32>(vel, 0.0, 0.0));
}
