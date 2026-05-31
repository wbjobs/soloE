export const BVH_VISUALIZE_SHADER = /* wgsl */ `
struct Camera {
  position: vec3<f32>,
  viewProj: mat4x4<f32>,
};

struct BVHNode {
  minX: f32,
  minY: f32,
  minZ: f32,
  leftChild: i32,
  maxX: f32,
  maxY: f32,
  maxZ: f32,
  rightChild: i32,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> bvhNodes: array<BVHNode>;
@group(0) @binding(2) var<uniform> targetLevel: u32;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
};

fn getLevelColor(level: u32) -> vec3<f32> {
  let hue = f32(level) * 0.1;
  return vec3<f32>(
    sin(hue * 6.28318) * 0.5 + 0.5,
    sin(hue * 6.28318 + 2.0) * 0.5 + 0.5,
    sin(hue * 6.28318 + 4.0) * 0.5 + 0.5
  );
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOutput {
  let lineIndex = vertexIndex / 2u;
  let nodeIndex = lineIndex / 12u;
  let edgeIndex = lineIndex % 12u;
  let isStart = (vertexIndex % 2u) == 0u;

  var output: VSOutput;
  output.color = vec3<f32>(0.0, 1.0, 0.0);

  if (nodeIndex >= arrayLength(&bvhNodes)) {
    output.position = vec4<f32>(0.0);
    return output;
  }

  let node = bvhNodes[nodeIndex];
  let min = vec3<f32>(node.minX, node.minY, node.minZ);
  let max = vec3<f32>(node.maxX, node.maxY, node.maxZ);

  let corners = array<vec3<f32>, 8>(
    min,
    vec3<f32>(max.x, min.y, min.z),
    vec3<f32>(max.x, max.y, min.z),
    vec3<f32>(min.x, max.y, min.z),
    vec3<f32>(min.x, min.y, max.z),
    vec3<f32>(max.x, min.y, max.z),
    max,
    vec3<f32>(min.x, max.y, max.z)
  );

  let edges = array<vec2<u32>, 12>(
    vec2<u32>(0u, 1u),
    vec2<u32>(1u, 2u),
    vec2<u32>(2u, 3u),
    vec2<u32>(3u, 0u),
    vec2<u32>(4u, 5u),
    vec2<u32>(5u, 6u),
    vec2<u32>(6u, 7u),
    vec2<u32>(7u, 4u),
    vec2<u32>(0u, 4u),
    vec2<u32>(1u, 5u),
    vec2<u32>(2u, 6u),
    vec2<u32>(3u, 7u)
  );

  let edge = edges[edgeIndex];
  let cornerIndex = select(edge.x, edge.y, isStart);
  var worldPos = corners[cornerIndex];

  let isLeaf = node.leftChild == -1 && node.rightChild == -1;
  if (isLeaf) {
    output.color = vec3<f32>(1.0, 0.5, 0.0);
  } else {
    output.color = getLevelColor(targetLevel);
  }

  let clipPos = camera.viewProj * vec4<f32>(worldPos, 1.0);
  output.position = clipPos;

  return output;
}

@fragment
fn fs_main(@location(0) color: vec3<f32>) -> @location(0) vec4<f32> {
  return vec4<f32>(color, 0.8);
}
`;

export const COMPOSITE_SHADER = /* wgsl */ `
@group(0) @binding(0) var raytraceTexture: texture_2d<f32>;
@group(0) @binding(1) var bvhTexture: texture_2d<f32>;
@group(0) @binding(2) var sampler: sampler;
@group(0) @binding(3) var<uniform> showBVH: f32;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOutput {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0)
  );

  var output: VSOutput;
  output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  output.uv = pos[vertexIndex] * 0.5 + 0.5;
  return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let raytraceColor = textureSample(raytraceTexture, sampler, uv);
  let bvhColor = textureSample(bvhTexture, sampler, uv);

  var finalColor = raytraceColor;
  if (showBVH > 0.5) {
    finalColor = mix(raytraceColor, bvhColor, bvhColor.a * 0.6);
  }

  return finalColor;
}
`;
