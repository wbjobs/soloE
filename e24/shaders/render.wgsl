@group(0) @binding(0) var density: texture_2d<f32>;
@group(0) @binding(1) var velocity: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>;
  @location(0) uv: vec2<f32>;
}

@vertex
fn vertex_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var out: VertexOutput;
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var uv = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(2.0, 1.0),
    vec2<f32>(0.0, -1.0)
  );
  out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = uv[vertexIndex];
  return out;
}

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let dims = vec2<f32>(textureDimensions(density));
  let texCoords = in.uv * dims;
  let color = textureLoad(density, vec2<i32>(texCoords), 0).rgb;
  
  let tonemapped = color / (color + 1.0);
  let gamma_corrected = pow(tonemapped, vec3<f32>(1.0 / 2.2));
  
  return vec4<f32>(gamma_corrected, 1.0);
}
