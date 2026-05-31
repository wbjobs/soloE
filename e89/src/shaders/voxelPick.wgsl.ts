export const VOXEL_PICK_SHADER = /* wgsl */ `
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

struct PickResult {
  hit: u32,
  voxelX: u32,
  voxelY: u32,
  voxelZ: u32,
  voxelIndex: i32,
  distance: f32,
  normalX: f32,
  normalY: f32,
  normalZ: f32,
};

struct PickUniforms {
  screenX: f32,
  screenY: f32,
  screenWidth: u32,
  screenHeight: u32,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read> bvhNodes: array<BVHNode>;
@group(0) @binding(2) var<storage, read> voxels: array<VoxelInfo>;
@group(0) @binding(3) var<storage, read_write> pickResult: PickResult;
@group(0) @binding(4) var<uniform> uniforms: PickUniforms;

struct Ray {
  origin: vec3<f32>,
  direction: vec3<f32>,
};

struct HitInfo {
  hit: bool,
  distance: f32,
  normal: vec3<f32>,
  voxelIndex: i32,
};

fn intersectAABB(ray: Ray, min: vec3<f32>, max: vec3<f32>) -> vec2<f32> {
  let invDir = 1.0 / ray.direction;
  let t0 = (min - ray.origin) * invDir;
  let t1 = (max - ray.origin) * invDir;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  return vec2<f32>(max(tmin.x, max(tmin.y, tmin.z)), min(tmax.x, min(tmax.y, tmax.z)));
}

fn intersectVoxel(ray: Ray, voxel: VoxelInfo, voxelIndex: i32) -> HitInfo {
  let min = vec3<f32>(f32(voxel.x), f32(voxel.y), f32(voxel.z));
  let max = min + vec3<f32>(1.0, 1.0, 1.0);
  let t = intersectAABB(ray, min, max);

  if (t.x > t.y || t.y < 0.0) {
    return HitInfo(false, 0.0, vec3<f32>(0.0), -1);
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

  return HitInfo(true, t.x, normal, voxelIndex);
}

@compute @workgroup_size(1, 1)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let uv = vec2<f32>(
    (uniforms.screenX / f32(uniforms.screenWidth)) * 2.0 - 1.0,
    (1.0 - uniforms.screenY / f32(uniforms.screenHeight)) * 2.0 - 1.0
  );

  let uv2 = vec2<f32>(
    uv.x * camera.aspect * tan(camera.fov * 0.5),
    uv.y * tan(camera.fov * 0.5)
  );

  var rayDirection = normalize(camera.forward + camera.right * uv2.x + camera.up * uv2.y);
  var ray = Ray(camera.position, rayDirection);

  var stack: array<i32, 64>;
  var stackTop = 0u;
  var closestHit = HitInfo(false, 1e30, vec3<f32>(0.0), -1);

  let rootIdx = i32(arrayLength(&bvhNodes)) - 1;
  stack[stackTop] = rootIdx;
  stackTop++;

  while (stackTop > 0u) {
    stackTop--;
    let nodeIdx = stack[stackTop];
    if (nodeIdx < 0) continue;

    let node = bvhNodes[u32(nodeIdx)];

    let t = intersectAABB(ray, vec3<f32>(node.minX, node.minY, node.minZ), vec3<f32>(node.maxX, node.maxY, node.maxZ));
    if (t.x > t.y || t.y < 0.0 || t.x > closestHit.distance) {
      continue;
    }

    if (node.leftChild == -1 && node.rightChild == -1) {
      if (u32(nodeIdx) < arrayLength(&voxels)) {
        let voxel = voxels[u32(nodeIdx)];
        let hit = intersectVoxel(ray, voxel, i32(nodeIdx));
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

  pickResult.hit = select(0u, 1u, closestHit.hit);
  if (closestHit.hit) {
    let voxel = voxels[u32(closestHit.voxelIndex)];
    pickResult.voxelX = voxel.x;
    pickResult.voxelY = voxel.y;
    pickResult.voxelZ = voxel.z;
    pickResult.voxelIndex = closestHit.voxelIndex;
    pickResult.distance = closestHit.distance;
    pickResult.normalX = closestHit.normal.x;
    pickResult.normalY = closestHit.normal.y;
    pickResult.normalZ = closestHit.normal.z;
  } else {
    pickResult.voxelIndex = -1;
  }
}
`;
