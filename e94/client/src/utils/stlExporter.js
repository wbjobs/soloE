const CHUNK_SIZE = 16

function writeVector(view, offset, x, y, z) {
  view.setFloat32(offset, x, true)
  view.setFloat32(offset + 4, y, true)
  view.setFloat32(offset + 8, z, true)
}

function createTriangleFaces(x, y, z, voxelSize) {
  const h = voxelSize / 2
  const faces = []

  const p0 = [-h + x, -h + y, h + z]
  const p1 = [h + x, -h + y, h + z]
  const p2 = [h + x, h + y, h + z]
  const p3 = [-h + x, h + y, h + z]
  const p4 = [-h + x, -h + y, -h + z]
  const p5 = [h + x, -h + y, -h + z]
  const p6 = [h + x, h + y, -h + z]
  const p7 = [-h + x, h + y, -h + z]

  faces.push([p0, p1, p2])
  faces.push([p0, p2, p3])
  faces.push([p5, p4, p7])
  faces.push([p5, p7, p6])
  faces.push([p4, p0, p3])
  faces.push([p4, p3, p7])
  faces.push([p1, p5, p6])
  faces.push([p1, p6, p2])
  faces.push([p3, p2, p6])
  faces.push([p3, p6, p7])
  faces.push([p4, p5, p1])
  faces.push([p4, p1, p0])

  return faces
}

function getVoxelValue(dataArray, x, y, z) {
  if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) {
    return 0
  }
  const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE
  return dataArray[index]
}

function isFaceExposed(dataArray, x, y, z, dx, dy, dz) {
  return getVoxelValue(dataArray, x + dx, y + dy, z + dz) === 0
}

function createExposedFaces(dataArray, x, y, z, voxelSize) {
  const h = voxelSize / 2
  const faces = []

  const p0 = [-h + x, -h + y, h + z]
  const p1 = [h + x, -h + y, h + z]
  const p2 = [h + x, h + y, h + z]
  const p3 = [-h + x, h + y, h + z]
  const p4 = [-h + x, -h + y, -h + z]
  const p5 = [h + x, -h + y, -h + z]
  const p6 = [h + x, h + y, -h + z]
  const p7 = [-h + x, h + y, -h + z]

  if (isFaceExposed(dataArray, x, y, z, 0, 0, 1)) {
    faces.push([p0, p1, p2])
    faces.push([p0, p2, p3])
  }
  if (isFaceExposed(dataArray, x, y, z, 0, 0, -1)) {
    faces.push([p5, p4, p7])
    faces.push([p5, p7, p6])
  }
  if (isFaceExposed(dataArray, x, y, z, -1, 0, 0)) {
    faces.push([p4, p0, p3])
    faces.push([p4, p3, p7])
  }
  if (isFaceExposed(dataArray, x, y, z, 1, 0, 0)) {
    faces.push([p1, p5, p6])
    faces.push([p1, p6, p2])
  }
  if (isFaceExposed(dataArray, x, y, z, 0, 1, 0)) {
    faces.push([p3, p2, p6])
    faces.push([p3, p6, p7])
  }
  if (isFaceExposed(dataArray, x, y, z, 0, -1, 0)) {
    faces.push([p4, p5, p1])
    faces.push([p4, p1, p0])
  }

  return faces
}

export function exportToSTL(voxelData, filename = 'model.stl', voxelSize = 10) {
  let dataArray
  try {
    const binaryString = atob(voxelData)
    dataArray = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      dataArray[i] = binaryString.charCodeAt(i)
    }
  } catch (e) {
    console.error('Failed to decode voxel data:', e)
    alert('导出失败：无法解析体素数据')
    return
  }

  const allFaces = []

  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE
        if (dataArray[index] > 0) {
          const faces = createExposedFaces(dataArray, x, y, z, voxelSize)
          allFaces.push(...faces)
        }
      }
    }
  }

  if (allFaces.length === 0) {
    alert('没有可导出的方块！')
    return
  }

  const headerSize = 80
  const triangleCount = allFaces.length
  const buffer = new ArrayBuffer(headerSize + 4 + triangleCount * 50)
  const view = new DataView(buffer)

  const headerText = 'Voxel Editor STL Export'
  const encoder = new TextEncoder()
  const headerBytes = encoder.encode(headerText)
  for (let i = 0; i < Math.min(headerBytes.length, 80); i++) {
    view.setUint8(i, headerBytes[i])
  }

  view.setUint32(80, triangleCount, true)

  for (let i = 0; i < triangleCount; i++) {
    const [v1, v2, v3] = allFaces[i]
    const offset = 84 + i * 50

    const ax = v2[0] - v1[0], ay = v2[1] - v1[1], az = v2[2] - v1[2]
    const bx = v3[0] - v1[0], by = v3[1] - v1[1], bz = v3[2] - v1[2]
    const nx = ay * bz - az * by
    const ny = az * bx - ax * bz
    const nz = ax * by - ay * bx
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1

    view.setFloat32(offset, nx / len, true)
    view.setFloat32(offset + 4, ny / len, true)
    view.setFloat32(offset + 8, nz / len, true)

    writeVector(view, offset + 12, v1[0], v1[1], v1[2])
    writeVector(view, offset + 24, v2[0], v2[1], v2[2])
    writeVector(view, offset + 36, v3[0], v3[1], v3[2])

    view.setUint16(offset + 48, 0, true)
  }

  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
