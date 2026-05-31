const CHUNK_SIZE = 16

const DEFAULT_PALETTE = new Uint32Array([
  0x00000000, 0xffffffff, 0xffccffff, 0xff99ffff, 0xff66ffff, 0xff33ffff, 0xff00ffff, 0xffffccff,
  0xffccccff, 0xff99ccff, 0xff66ccff, 0xff33ccff, 0xff00ccff, 0xffff99ff, 0xffcc99ff, 0xff9999ff,
  0xff6699ff, 0xff3399ff, 0xff0099ff, 0xffff66ff, 0xffcc66ff, 0xff9966ff, 0xff6666ff, 0xff3366ff,
  0xff0066ff, 0xffff33ff, 0xffcc33ff, 0xff9933ff, 0xff6633ff, 0xff3333ff, 0xff0033ff, 0xffff00ff,
  0xffcc00ff, 0xff9900ff, 0xff6600ff, 0xff3300ff, 0xff0000ff, 0xffffffcc, 0xffccffcc, 0xff99ffcc,
  0xff66ffcc, 0xff33ffcc, 0xff00ffcc, 0xffffcccc, 0xffcccccc, 0xff99cccc, 0xff66cccc, 0xff33cccc,
  0xff00cccc, 0xffff99cc, 0xffcc99cc, 0xff9999cc, 0xff6699cc, 0xff3399cc, 0xff0099cc, 0xffff66cc,
  0xffcc66cc, 0xff9966cc, 0xff6666cc, 0xff3366cc, 0xff0066cc, 0xffff33cc, 0xffcc33cc, 0xff9933cc,
  0xff6633cc, 0xff3333cc, 0xff0033cc, 0xffff00cc, 0xffcc00cc, 0xff9900cc, 0xff6600cc, 0xff3300cc,
  0xff0000cc, 0xffffff99, 0xffccff99, 0xff99ff99, 0xff66ff99, 0xff33ff99, 0xff00ff99, 0xffffcc99,
  0xffcccc99, 0xff99cc99, 0xff66cc99, 0xff33cc99, 0xff00cc99, 0xffff9999, 0xffcc9999, 0xff999999,
  0xff669999, 0xff339999, 0xff009999, 0xffff6699, 0xffcc6699, 0xff996699, 0xff666699, 0xff336699,
  0xff006699, 0xffff3399, 0xffcc3399, 0xff993399, 0xff663399, 0xff333399, 0xff003399, 0xffff0099,
  0xffcc0099, 0xff990099, 0xff660099, 0xff330099, 0xff000099, 0xffffff66, 0xffccff66, 0xff99ff66,
  0xff66ff66, 0xff33ff66, 0xff00ff66, 0xffffcc66, 0xffcccc66, 0xff99cc66, 0xff66cc66, 0xff33cc66,
  0xff00cc66, 0xffff9966, 0xffcc9966, 0xff999966, 0xff669966, 0xff339966, 0xff009966, 0xffff6666,
  0xffcc6666, 0xff996666, 0xff666666, 0xff336666, 0xff006666, 0xffff3366, 0xffcc3366, 0xff993366,
  0xff663366, 0xff333366, 0xff003366, 0xffff0066, 0xffcc0066, 0xff990066, 0xff660066, 0xff330066,
  0xff000066, 0xffffff33, 0xffccff33, 0xff99ff33, 0xff66ff33, 0xff33ff33, 0xff00ff33, 0xffffcc33,
  0xffcccc33, 0xff99cc33, 0xff66cc33, 0xff33cc33, 0xff00cc33, 0xffff9933, 0xffcc9933, 0xff999933,
  0xff669933, 0xff339933, 0xff009933, 0xffff6633, 0xffcc6633, 0xff996633, 0xff666633, 0xff336633,
  0xff006633, 0xffff3333, 0xffcc3333, 0xff993333, 0xff663333, 0xff333333, 0xff003333, 0xffff0033,
  0xffcc0033, 0xff990033, 0xff660033, 0xff330033, 0xff000033, 0xffffff00, 0xffccff00,
  0xff99ff00, 0xff66ff00, 0xff33ff00, 0xff00ff00, 0xffffcc00, 0xffcccc00, 0xff99cc00, 0xff66cc00,
  0xff33cc00, 0xff00cc00, 0xffff9900, 0xffcc9900, 0xff999900, 0xff669900, 0xff339900, 0xff009900,
  0xffff6600, 0xffcc6600, 0xff996600, 0xff666600, 0xff336600, 0xff006600, 0xffff3300,
  0xffcc3300, 0xff993300, 0xff663300, 0xff333300, 0xff003300, 0xffff0000, 0xffcc0000,
  0xff990000, 0xff660000, 0xff330000, 0xff0000ee, 0xff0000dd, 0xff0000bb, 0xff0000aa, 0xff000088,
  0xff000077, 0xff000055, 0xff000044, 0xff000022, 0xff000011, 0xff00ee00, 0xff00dd00,
  0xff00bb00, 0xff00aa00, 0xff008800, 0xff007700, 0xff005500, 0xff004400, 0xff002200,
  0xff001100, 0xffee0000, 0xffdd0000, 0xffbb0000, 0xffaa0000, 0xff880000, 0xff770000,
  0xff550000, 0xff440000, 0xff220000, 0xff110000, 0xffeeeeee, 0xffdddddd, 0xffbbbbbb,
  0xffaaaaaa, 0xff888888, 0xff777777, 0xff555555, 0xff444444, 0xff222222, 0xff111111
])

class VoxWriter {
  constructor() {
    this.chunks = []
  }

  writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeInt32(view, offset, value) {
    view.setUint32(offset, value, true)
  }

  createChunk(id, content, children = []) {
    const contentBuffer = content || new ArrayBuffer(0)
    const childrenBuffer = this.concatBuffers(children)

    const chunk = new ArrayBuffer(12 + contentBuffer.byteLength + childrenBuffer.byteLength)
    const view = new DataView(chunk)

    this.writeString(view, 0, id)
    this.writeInt32(view, 4, contentBuffer.byteLength)
    this.writeInt32(view, 8, childrenBuffer.byteLength)

    new Uint8Array(chunk, 12).set(new Uint8Array(contentBuffer))
    new Uint8Array(chunk, 12 + contentBuffer.byteLength).set(new Uint8Array(childrenBuffer))

    return chunk
  }

  concatBuffers(buffers) {
    let total = 0
    for (const buf of buffers) total += buf.byteLength
    const result = new ArrayBuffer(total)
    const arr = new Uint8Array(result)
    let offset = 0
    for (const buf of buffers) {
      arr.set(new Uint8Array(buf), offset)
      offset += buf.byteLength
    }
    return result
  }

  createSizeChunk(sx, sy, sz) {
    const content = new ArrayBuffer(12)
    const view = new DataView(content)
    this.writeInt32(view, 0, sx)
    this.writeInt32(view, 4, sy)
    this.writeInt32(view, 8, sz)
    return this.createChunk('SIZE', content)
  }

  createXYZIChunk(voxels) {
    const content = new ArrayBuffer(4 + voxels.length * 4)
    const view = new DataView(content)
    this.writeInt32(view, 0, voxels.length)
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i]
      const offset = 4 + i * 4
      view.setUint8(offset, v.x)
      view.setUint8(offset + 1, v.y)
      view.setUint8(offset + 2, v.z)
      view.setUint8(offset + 3, v.colorIndex)
    }
    return this.createChunk('XYZI', content)
  }

  createRGBAChunk() {
    const content = new ArrayBuffer(256 * 4)
    const view = new DataView(content)
    for (let i = 0; i < 256; i++) {
      const color = DEFAULT_PALETTE[i] || 0xffffffff
      const offset = i * 4
      view.setUint8(offset, (color >> 0) & 0xff)
      view.setUint8(offset + 1, (color >> 8) & 0xff)
      view.setUint8(offset + 2, (color >> 16) & 0xff)
      view.setUint8(offset + 3, (color >> 24) & 0xff)
    }
    return this.createChunk('RGBA', content)
  }

  createDictEntry(key, value) {
    const keyBuf = this.createString(key)
    const valueBuf = this.createString(value)
    const entry = new ArrayBuffer(keyBuf.byteLength + valueBuf.byteLength)
    const arr = new Uint8Array(entry)
    arr.set(new Uint8Array(keyBuf), 0)
    arr.set(new Uint8Array(valueBuf), keyBuf.byteLength)
    return entry
  }

  createDict(entries) {
    const content = new ArrayBuffer(4)
    const view = new DataView(content)
    this.writeInt32(view, 0, entries.length)

    const entryBuffers = entries.map(([k, v]) => this.createDictEntry(k, v))
    return this.concatBuffers([content, ...entryBuffers])
  }

  createString(str) {
    const encoder = new TextEncoder()
    const strBytes = encoder.encode(str)
    const buf = new ArrayBuffer(4 + strBytes.length)
    const view = new DataView(buf)
    this.writeInt32(view, 0, strBytes.length)
    new Uint8Array(buf, 4).set(strBytes)
    return buf
  }

  createNTRNChunk(nodeId, attributes, childId) {
    const content = new ArrayBuffer(24)
    const view = new DataView(content)
    this.writeInt32(view, 0, nodeId)
    this.writeInt32(view, 4, 0)
    this.writeInt32(view, 8, childId)
    this.writeInt32(view, 12, 0)
    this.writeInt32(view, 16, 0)
    this.writeInt32(view, 20, 0)
    return this.createChunk('nTRN', content)
  }

  createNGRPChunk(nodeId, childIds) {
    const content = new ArrayBuffer(8 + childIds.length * 4)
    const view = new DataView(content)
    this.writeInt32(view, 0, nodeId)
    this.writeInt32(view, 4, 0)
    this.writeInt32(view, 8, childIds.length)
    for (let i = 0; i < childIds.length; i++) {
      this.writeInt32(view, 12 + i * 4, childIds[i])
    }
    return this.createChunk('nGRP', content)
  }

  createNSHPChunk(nodeId, modelId) {
    const content = new ArrayBuffer(20)
    const view = new DataView(content)
    this.writeInt32(view, 0, nodeId)
    this.writeInt32(view, 4, 0)
    this.writeInt32(view, 8, 1)
    this.writeInt32(view, 12, modelId)
    this.writeInt32(view, 16, 0)
    return this.createChunk('nSHP', content)
  }

  createLAYRChunk(layerId, name) {
    const nameBuf = this.createString(name)
    const content = new ArrayBuffer(4 + nameBuf.byteLength + 4)
    const view = new DataView(content)
    this.writeInt32(view, 0, layerId)
    new Uint8Array(content, 4).set(new Uint8Array(nameBuf))
    this.writeInt32(view, 4 + nameBuf.byteLength, 0)
    return this.createChunk('LAYR', content)
  }

  build(voxels, sx, sy, sz) {
    const sizeChunk = this.createSizeChunk(sx, sy, sz)
    const xyziChunk = this.createXYZIChunk(voxels)
    const rgbaChunk = this.createRGBAChunk()

    const ntrnChunk = this.createNTRNChunk(0, {}, 1)
    const ngrpChunk = this.createNGRPChunk(1, [2])
    const nshpChunk = this.createNSHPChunk(2, 0)
    const layrChunk = this.createLAYRChunk(0, 'Layer 1')

    const mainContent = new ArrayBuffer(0)
    const mainChildren = [
      sizeChunk, xyziChunk, rgbaChunk,
      ntrnChunk, ngrpChunk, nshpChunk, layrChunk
    ]
    const mainChunk = this.createChunk('MAIN', mainContent, mainChildren)

    const header = new ArrayBuffer(20)
    const headerView = new DataView(header)
    this.writeString(headerView, 0, 'VOX ')
    this.writeInt32(headerView, 4, 150)
    this.writeString(headerView, 8, 'MAIN')
    this.writeInt32(headerView, 12, 0)
    this.writeInt32(headerView, 16, 0)

    return this.concatBuffers([header, mainChunk])
  }
}

export function exportToVox(voxelData, filename = 'model.vox') {
  const voxels = []
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

  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE
        const colorIndex = dataArray[index]
        if (colorIndex > 0 && colorIndex < 256) {
          voxels.push({ x, y, z, colorIndex })
        }
      }
    }
  }

  if (voxels.length === 0) {
    alert('没有可导出的方块！')
    return
  }

  const writer = new VoxWriter()
  const buffer = writer.build(voxels, CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE)

  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
