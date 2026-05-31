export const BVH_BUILD_OPTIMIZED_SHADER = /* wgsl */ `
struct VoxelInfo {
  x: u32,
  y: u32,
  z: u32,
  value: u32,
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

struct SortItem {
  morton: u32,
  index: u32,
};

struct BuildUniforms {
  voxelCount: u32,
  batchStart: u32,
  batchEnd: u32,
  phase: u32,
};

@group(0) @binding(0) var<storage, read> voxels: array<VoxelInfo>;
@group(0) @binding(1) var<storage, read_write> bvhNodes: array<BVHNode>;
@group(0) @binding(2) var<storage, read_write> sortItems: array<SortItem>;
@group(0) @binding(3) var<storage, read_write> nodeParents: array<i32>;
@group(0) @binding(4) var<uniform> uniforms: BuildUniforms;

fn expandBits(v: u32) -> u32 {
  var x = v & 0x3ff;
  x = (x | (x << 16)) & 0x030000ff;
  x = (x | (x << 8)) & 0x0300f00f;
  x = (x | (x << 4)) & 0x030c30c3;
  x = (x | (x << 2)) & 0x09249249;
  return x;
}

fn morton3D(x: u32, y: u32, z: u32) -> u32 {
  return (expandBits(z) << 2) | (expandBits(y) << 1) | expandBits(x);
}

@compute @workgroup_size(256)
fn generateMortonCodes(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = uniforms.batchStart + globalId.x;
  let voxelCount = uniforms.voxelCount;

  if (idx >= uniforms.batchEnd || idx >= voxelCount) {
    return;
  }

  let voxel = voxels[idx];
  let code = morton3D(voxel.x, voxel.y, voxel.z);

  sortItems[idx].morton = code;
  sortItems[idx].index = idx;

  bvhNodes[idx].minX = f32(voxel.x);
  bvhNodes[idx].minY = f32(voxel.y);
  bvhNodes[idx].minZ = f32(voxel.z);
  bvhNodes[idx].maxX = f32(voxel.x) + 1.0;
  bvhNodes[idx].maxY = f32(voxel.y) + 1.0;
  bvhNodes[idx].maxZ = f32(voxel.z) + 1.0;
  bvhNodes[idx].leftChild = -1;
  bvhNodes[idx].rightChild = -1;
  nodeParents[idx] = -1;
}

@compute @workgroup_size(128)
fn buildBVHNodes(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = uniforms.batchStart + globalId.x;
  let voxelCount = uniforms.voxelCount;
  let internalNodes = voxelCount - 1u;

  if (idx >= uniforms.batchEnd || idx >= internalNodes) {
    return;
  }

  let nodeIdx = voxelCount + idx;

  let leftChildRaw = idx;
  let rightChildRaw = idx + 1u;

  var leftChild: i32;
  var rightChild: i32;

  if (leftChildRaw < voxelCount) {
    leftChild = i32(leftChildRaw);
  } else {
    leftChild = i32(voxelCount + (leftChildRaw - voxelCount));
  }

  if (rightChildRaw < voxelCount) {
    rightChild = i32(rightChildRaw);
  } else {
    rightChild = i32(voxelCount + (rightChildRaw - voxelCount));
  }

  let left = bvhNodes[u32(leftChild)];
  let right = bvhNodes[u32(rightChild)];

  bvhNodes[nodeIdx].minX = min(left.minX, right.minX);
  bvhNodes[nodeIdx].minY = min(left.minY, right.minY);
  bvhNodes[nodeIdx].minZ = min(left.minZ, right.minZ);
  bvhNodes[nodeIdx].maxX = max(left.maxX, right.maxX);
  bvhNodes[nodeIdx].maxY = max(left.maxY, right.maxY);
  bvhNodes[nodeIdx].maxZ = max(left.maxZ, right.maxZ);
  bvhNodes[nodeIdx].leftChild = leftChild;
  bvhNodes[nodeIdx].rightChild = rightChild;

  nodeParents[u32(leftChild)] = i32(nodeIdx);
  nodeParents[u32(rightChild)] = i32(nodeIdx);
}

@compute @workgroup_size(64)
fn refitBVH(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = uniforms.batchStart + globalId.x;
  let voxelCount = uniforms.voxelCount;
  let internalNodes = voxelCount - 1u;

  if (idx >= uniforms.batchEnd || idx >= internalNodes) {
    return;
  }

  let nodeIdx = voxelCount + (internalNodes - 1u - idx);
  let node = bvhNodes[nodeIdx];

  if (node.leftChild >= 0 && node.rightChild >= 0) {
    let left = bvhNodes[u32(node.leftChild)];
    let right = bvhNodes[u32(node.rightChild)];

    bvhNodes[nodeIdx].minX = min(left.minX, right.minX);
    bvhNodes[nodeIdx].minY = min(left.minY, right.minY);
    bvhNodes[nodeIdx].minZ = min(left.minZ, right.minZ);
    bvhNodes[nodeIdx].maxX = max(left.maxX, right.maxX);
    bvhNodes[nodeIdx].maxY = max(left.maxY, right.maxY);
    bvhNodes[nodeIdx].maxZ = max(left.maxZ, right.maxZ);
  }
}
`;
