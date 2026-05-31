@group(0) @binding(0) var<uniform> dt: f32;
@group(0) @binding(1) var<uniform> dissipation: f32;
@group(0) @binding(2) var<uniform> texelSize: vec2<f32>;
@group(0) @binding(3) var inputVelocity: texture_2d<f32>;
@group(0) @binding(4) var inputQuantity: texture_2d<f32>;
@group(0) @binding(5) var outputTexture: texture_storage_2d<rgba16float, write>;

fn bilerp(tex: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(tex));
  let clampedUv = clamp(uv, vec2(0.5 / dims, 1.0 - 0.5 / dims));
  let st = clampedUv * dims - 0.5;
  let iuv = floor(st);
  let fuv = fract(st);
  
  let maxCoords = dims - 1.0;
  let a = textureLoad(tex, vec2<u32>(clamp(iuv, vec2(0.0), maxCoords)), 0);
  let b = textureLoad(tex, vec2<u32>(clamp(iuv + vec2(1.0, 0.0), vec2(0.0), maxCoords)), 0);
  let c = textureLoad(tex, vec2<u32>(clamp(iuv + vec2(0.0, 1.0), vec2(0.0), maxCoords)), 0);
  let d = textureLoad(tex, vec2<u32>(clamp(iuv + vec2(1.0, 1.0), vec2(0.0), maxCoords)), 0);
  
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(inputVelocity);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  
  let uv = (vec2<f32>(id.xy) + 0.5) * texelSize;
  let velocity = textureLoad(inputVelocity, vec2<i32>(id.xy), 0).xy;
  
  let tracePos = uv - velocity * dt;
  let result = bilerp(inputQuantity, tracePos);
  let damped = result * (1.0 - dissipation * dt);
  
  textureStore(outputTexture, vec2<i32>(id.xy), damped);
}
