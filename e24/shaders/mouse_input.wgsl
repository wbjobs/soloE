@group(0) @binding(0) var<uniform> mousePos: vec2<f32>;
@group(0) @binding(1) var<uniform> mouseDelta: vec2<f32>;
@group(0) @binding(2) var<uniform> mouseColor: vec3<f32>;
@group(0) @binding(3) var<uniform> radius: f32;
@group(0) @binding(4) var<uniform> force: f32;
@group(0) @binding(5) var<uniform> dt: f32;
@group(0) @binding(6) var<uniform> isVelocity: u32;
@group(0) @binding(7) var inputTexture: texture_2d<f32>;
@group(0) @binding(8) var outputTexture: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(inputTexture);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  
  let pos = vec2<i32>(id.xy);
  let uv = (vec2<f32>(pos) + 0.5) / vec2<f32>(dims);
  
  let dist = length(uv - mousePos);
  let falloff = max(0.0, 1.0 - dist / radius);
  
  let input = textureLoad(inputTexture, pos, 0);
  
  if (isVelocity == 1u) {
    let addedForce = mouseDelta * falloff * force * dt;
    let result = vec4<f32>(input.xy + addedForce, 0.0, 0.0);
    textureStore(outputTexture, pos, result);
  } else {
    let addedColor = mouseColor * falloff * 5.0 * dt;
    let result = vec4<f32>(input.rgb + addedColor, 1.0);
    textureStore(outputTexture, pos, result);
  }
}
