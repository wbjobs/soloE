@group(0) @binding(0) var<uniform> alpha: f32;
@group(0) @binding(1) var<uniform> beta: f32;
@group(0) @binding(2) var divergence: texture_2d<f32>;
@group(0) @binding(3) var pressure: texture_2d<f32>;
@group(0) @binding(4) var outputPressure: texture_storage_2d<r16float, write>;

fn samplePressureNeumann(tex: texture_2d<f32>, pos: vec2<i32>, dims: vec2<u32>) -> f32 {
  let clampedPos = clamp(pos, vec2<i32>(0), vec2<i32>(dims) - 1);
  return textureLoad(tex, clampedPos, 0).x;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(divergence);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  
  let pos = vec2<i32>(id.xy);
  
  let isOnBoundary = pos.x == 0 || pos.x == vec2<i32>(dims).x - 1 || 
                     pos.y == 0 || pos.y == vec2<i32>(dims).y - 1;
  
  if (isOnBoundary) {
    let neighborPos = select(
      select(pos, pos + vec2<i32>(1, 0), pos.x == 0),
      pos - vec2<i32>(1, 0),
      pos.x == vec2<i32>(dims).x - 1
    );
    let finalNeighborPos = select(
      select(neighborPos, neighborPos + vec2<i32>(0, 1), pos.y == 0),
      neighborPos - vec2<i32>(0, 1),
      pos.y == vec2<i32>(dims).y - 1
    );
    let p = textureLoad(pressure, finalNeighborPos, 0).x;
    textureStore(outputPressure, pos, vec4<f32>(p, 0.0, 0.0, 0.0));
    return;
  }
  
  let L = samplePressureNeumann(pressure, pos + vec2<i32>(-1, 0), dims);
  let R = samplePressureNeumann(pressure, pos + vec2<i32>(1, 0), dims);
  let T = samplePressureNeumann(pressure, pos + vec2<i32>(0, -1), dims);
  let B = samplePressureNeumann(pressure, pos + vec2<i32>(0, 1), dims);
  let div = textureLoad(divergence, pos, 0).x;
  
  let p = (L + R + T + B + alpha * div) * beta;
  textureStore(outputPressure, pos, vec4<f32>(p, 0.0, 0.0, 0.0));
}
