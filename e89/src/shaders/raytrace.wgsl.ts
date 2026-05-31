export const RAYTRACE_SHADER = /* wgsl */ `
struct Camera {
  position: vec3<f32>,
  forward: vec3<f32>,
  right: vec3<f32>,
  up: vec3<f32>,
  fov: f32,
  aspect: f32,
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

struct VoxelInfo {
  x: u32,
  y: u32,
  z: u32,
  value: u32,
};

struct RenderSettings {
  raysPerPixel: u32,
  maxBounces: u32,
  frame: u32,
  showBVH: u32,
  bvhLevel: u32,
  clearTraversal: u32,
};

struct Ray {
  origin: vec3<f32>,
  direction: vec3<f32>,
};

struct HitInfo {
  hit: bool,
  distance: f32,
  normal: vec3<f32>,
  color: vec3<f32>,
  voxelValue: u32,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> bvhNodes: array<BVHNode>;
@group(0) @binding(2) var<storage, read> voxels: array<VoxelInfo>;
@group(0) @binding(3) var<storage, read_write> outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> settings: RenderSettings;
@group(0) @binding(5) var<storage, read_write> traversalCounts: array<atomic<u32>>;

fn intersectAABB(ray: Ray, min: vec3<f32>, max: vec3<f32>) -> vec2<f32> {
  let invDir = 1.0 / ray.direction;
  let t0 = (min - ray.origin) * invDir;
  let t1 = (max - ray.origin) * invDir;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  return vec2<f32>(max(tmin.x, max(tmin.y, tmin.z)), min(tmax.x, min(tmax.y, tmax.z)));
}

fn getVoxelColor(value: u32) -> vec3<f32> {
  let normalized = f32(value) / 255.0;
  return vec3<f32>(
    sin(normalized * 6.28318) * 0.5 + 0.5,
    sin(normalized * 6.28318 + 2.0) * 0.5 + 0.5,
    sin(normalized * 6.28318 + 4.0) * 0.5 + 0.5
  );
}

fn intersectVoxel(ray: Ray, voxel: VoxelInfo) -> HitInfo {
  let min = vec3<f32>(f32(voxel.x), f32(voxel.y), f32(voxel.z));
  let max = min + vec3<f32>(1.0, 1.0, 1.0);
  let t = intersectAABB(ray, min, max);

  if (t.x > t.y || t.y < 0.0) {
    return HitInfo(false, 0.0, vec3<f32>(0.0), vec3<f32>(0.0), 0u);
  }

  let hitPoint = ray.origin + ray.direction * t.x;
  var normal = vec3<f32>(0.0);
  let epsilon = 0.001;

  if (abs(hitPoint.x - min.x) < epsilon) normal = vec3<f32>(-1.0, 0.0, 0.0);
  else if (abs(hitPoint.x - max.x) < epsilon) normal = vec3<f32>(1.0, 0.0, 0.0);
  else if (abs(hitPoint.y - min.y) < epsilon) normal = vec3<f32>(0.0, -1.0, 0.0);
  else if (abs(hitPoint.y - max.y) < epsilon) normal = vec3<f32>(0.0, 1.0, 0.0);
  else if (abs(hitPoint.z - min.z) < epsilon) normal = vec3<f32>(0.0, 0.0, -1.0);
  else normal = vec3<f32>(0.0, 0.0, 1.0);

  return HitInfo(true, t.x, normal, getVoxelColor(voxel.value), voxel.value);
}

fn traverseBVH(ray: Ray, pixelIdx: u32) -> HitInfo {
  var stack: array<i32, 64>;
  var stackTop = 0u;
  var closestHit = HitInfo(false, 1e30, vec3<f32>(0.0), vec3<f32>(0.0), 0u);
  var traversalCount = 0u;

  let rootIdx = i32(arrayLength(&bvhNodes)) - 1;
  stack[stackTop] = rootIdx;
  stackTop++;

  while (stackTop > 0u) {
    stackTop--;
    let nodeIdx = stack[stackTop];
    if (nodeIdx < 0) continue;

    let node = bvhNodes[u32(nodeIdx)];
    traversalCount++;

    let t = intersectAABB(ray, vec3<f32>(node.minX, node.minY, node.minZ), vec3<f32>(node.maxX, node.maxY, node.maxZ));
    if (t.x > t.y || t.y < 0.0 || t.x > closestHit.distance) {
      continue;
    }

    if (node.leftChild == -1 && node.rightChild == -1) {
      if (u32(nodeIdx) < arrayLength(&voxels)) {
        let voxel = voxels[u32(nodeIdx)];
        let hit = intersectVoxel(ray, voxel);
        if (hit.hit && hit.distance < closestHit.distance) {
          closestHit = hit;
        }
      }
    } else {
      stack[stackTop] = node.leftChild;
      stackTop++;
      stack[stackTop] = node.rightChild;
      stackTop++;
    }
  }

  atomicAdd(&traversalCounts[pixelIdx], traversalCount);
  return closestHit;
}

fn randomFloat(seed: u32) -> f32 {
  var s = seed;
  s = s ^ (s << 13u);
  s = s ^ (s >> 17u);
  s = s ^ (s << 5u);
  return f32(s) / 4294967295.0;
}

fn randomHemisphereDirection(normal: vec3<f32>, seed: u32) -> vec3<f32> {
  let u1 = randomFloat(seed);
  let u2 = randomFloat(seed + 1u);
  let r = sqrt(1.0 - u1 * u1);
  let phi = 6.28318 * u2;

  var tangent = vec3<f32>(1.0, 0.0, 0.0);
  if (abs(normal.x) > 0.99) tangent = vec3<f32>(0.0, 1.0, 0.0);
  let bitangent = normalize(cross(normal, tangent));
  let localTangent = normalize(cross(bitangent, normal));

  let localDir = vec3<f32>(r * cos(phi), u1, r * sin(phi));
  return normalize(localTangent * localDir.x + normal * localDir.y + bitangent * localDir.z);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let dims = textureDimensions(outputTexture);
  if (globalId.x >= dims.x || globalId.y >= dims.y) {
    return;
  }

  let pixelIdx = globalId.y * dims.x + globalId.x;

  if (settings.clearTraversal == 1u) {
    atomicStore(&traversalCounts[pixelIdx], 0u);
  }

  var finalColor = vec3<f32>(0.0);

  for (var rayIdx = 0u; rayIdx < settings.raysPerPixel; rayIdx++) {
    let seed = (settings.frame * 100000u) + pixelIdx * 64u + rayIdx;

    let jitterX = randomFloat(seed) - 0.5;
    let jitterY = randomFloat(seed + 1u) - 0.5;

    let uv = (vec2<f32>(f32(globalId.x) + jitterX, f32(globalId.y) + jitterY) / vec2<f32>(f32(dims.x), f32(dims.y))) * 2.0 - 1.0;
    let uv2 = vec2<f32>(uv.x * camera.aspect * tan(camera.fov * 0.5), uv.y * tan(camera.fov * 0.5));

    var rayDirection = normalize(camera.forward + camera.right * uv2.x + camera.up * uv2.y);
    var ray = Ray(camera.position, rayDirection);

    var color = vec3<f32>(0.0);
    var throughput = vec3<f32>(1.0, 1.0, 1.0);
    var hitCount = 0u;

    for (var bounce = 0u; bounce < settings.maxBounces; bounce++) {
      let hit = traverseBVH(ray, pixelIdx);
      if (!hit.hit) {
        let skyColor = mix(vec3<f32>(0.3, 0.5, 0.8), vec3<f32>(0.8, 0.9, 1.0), ray.direction.y * 0.5 + 0.5);
        color += throughput * skyColor;
        break;
      }

      hitCount++;
      let lightDir = normalize(vec3<f32>(0.5, 0.8, 0.3));
      let NdotL = max(dot(hit.normal, lightDir), 0.0);
      let ambient = 0.15;
      let diffuse = hit.color * (ambient + NdotL * 0.7);

      color += throughput * diffuse * 0.6;
      throughput *= hit.color * 0.4;

      ray.origin = hit.normal * 0.01 + ray.origin + ray.direction * hit.distance;
      ray.direction = randomHemisphereDirection(hit.normal, seed + bounce * 100u + rayIdx * 10u);
    }

    if (hitCount == 0u) {
      let skyColor = mix(vec3<f32>(0.3, 0.5, 0.8), vec3<f32>(0.8, 0.9, 1.0), ray.direction.y * 0.5 + 0.5);
      color = skyColor;
    }

    finalColor += color;
  }

  finalColor /= f32(settings.raysPerPixel);
  finalColor = pow(finalColor, vec3<f32>(1.0 / 2.2));

  textureStore(outputTexture, vec2<i32>(i32(globalId.x), i32(globalId.y)), vec4<f32>(finalColor, 1.0));
}
`;

export const PRESENT_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> sourceTexture: texture_storage_2d<rgba8unorm, read>;

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
  let dims = textureDimensions(sourceTexture);
  let texCoord = vec2<i32>(i32(uv.x * f32(dims.x)), i32(uv.y * f32(dims.y)));
  return textureLoad(sourceTexture, texCoord, 0);
}
`;
