@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(inputTexture);
  if (id.x >= dims.x || id.y >= dims.y) {
    return;
  }
  
  let pos = vec2<i32>(id.xy);
  let isOnBoundary = pos.x == 0 || pos.x == vec2<i32>(dims).x - 1 || 
                     pos.y == 0 || pos.y == vec2<i32>(dims).y - 1;
  
  if (isOnBoundary) {
    let input = textureLoad(inputTexture, pos, 0);
    let clampedColor = max(vec3<f32>(0.0), input.rgb);
    textureStore(outputTexture, pos, vec4<f32>(clampedColor, 1.0));
  } else {
    textureStore(outputTexture, pos, textureLoad(inputTexture, pos, 0));
  }
}
