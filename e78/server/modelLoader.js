const fs = require('fs');
const path = require('path');

class ModelLoader {
  loadOBJ(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const vertices = [];
    const faces = [];
    const normals = [];
    const uvs = [];

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const parts = trimmed.split(/\s+/);
      const type = parts[0];

      if (type === 'v') {
        vertices.push([
          parseFloat(parts[1]),
          parseFloat(parts[2]),
          parseFloat(parts[3])
        ]);
      } else if (type === 'vn') {
        normals.push([
          parseFloat(parts[1]),
          parseFloat(parts[2]),
          parseFloat(parts[3])
        ]);
      } else if (type === 'vt') {
        uvs.push([
          parseFloat(parts[1]),
          parseFloat(parts[2])
        ]);
      } else if (type === 'f') {
        const face = [];
        for (let i = 1; i < parts.length; i++) {
          const indices = parts[i].split('/');
          face.push({
            vertex: parseInt(indices[0]) - 1,
            uv: indices[1] ? parseInt(indices[1]) - 1 : -1,
            normal: indices[2] ? parseInt(indices[2]) - 1 : -1
          });
        }
        faces.push(face);
      }
    }

    return { vertices, faces, normals, uvs };
  }

  loadGLTF(filePath) {
    const content = fs.readFileSync(filePath);
    const isGLB = content[0] === 0x67 && content[1] === 0x6C && content[2] === 0x54 && content[3] === 0x46;
    
    let json;
    let binaryData = null;

    if (isGLB) {
      const offset = 12;
      const jsonLength = content.readUInt32LE(8);
      const jsonContent = content.slice(offset, offset + jsonLength).toString('utf-8');
      json = JSON.parse(jsonContent);
      
      const binaryOffset = offset + jsonLength;
      if (content.length > binaryOffset) {
        binaryData = content.slice(binaryOffset);
      }
    } else {
      json = JSON.parse(content.toString('utf-8'));
      const binFile = path.join(path.dirname(filePath), json.buffers[0].uri);
      if (fs.existsSync(binFile)) {
        binaryData = fs.readFileSync(binFile);
      }
    }

    return this.parseGLTF(json, binaryData);
  }

  parseGLTF(json, binaryData) {
    const vertices = [];
    const faces = [];

    const accessors = json.accessors;
    const bufferViews = json.bufferViews;
    const meshes = json.meshes;

    const buffers = [];
    for (const bufferView of bufferViews) {
      if (binaryData) {
        const start = bufferView.byteOffset || 0;
        const end = start + (bufferView.byteLength || 0);
        buffers.push(binaryData.slice(start, end));
      }
    }

    const readAccessor = (accessorIndex) => {
      const accessor = accessors[accessorIndex];
      const bufferView = bufferViews[accessor.bufferView];
      const buffer = buffers[accessor.bufferView] || binaryData;
      if (!buffer) return [];

      const byteOffset = (accessor.byteOffset || 0) + (bufferView.byteOffset || 0);
      const count = accessor.count;
      const componentType = accessor.componentType;
      const type = accessor.type;

      let elementSize;
      let TypedArray;
      switch (componentType) {
        case 5120: TypedArray = Int8Array; elementSize = 1; break;
        case 5121: TypedArray = Uint8Array; elementSize = 1; break;
        case 5122: TypedArray = Int16Array; elementSize = 2; break;
        case 5123: TypedArray = Uint16Array; elementSize = 2; break;
        case 5125: TypedArray = Uint32Array; elementSize = 4; break;
        case 5126: TypedArray = Float32Array; elementSize = 4; break;
        default: return [];
      }

      let components;
      switch (type) {
        case 'SCALAR': components = 1; break;
        case 'VEC2': components = 2; break;
        case 'VEC3': components = 3; break;
        case 'VEC4': components = 4; break;
        default: return [];
      }

      const view = new DataView(buffer.buffer, buffer.byteOffset + byteOffset);
      const result = [];
      
      for (let i = 0; i < count; i++) {
        const elem = [];
        for (let c = 0; c < components; c++) {
          const offset = (i * components + c) * elementSize;
          switch (componentType) {
            case 5120: elem.push(view.getInt8(offset)); break;
            case 5121: elem.push(view.getUint8(offset)); break;
            case 5122: elem.push(view.getInt16(offset, true)); break;
            case 5123: elem.push(view.getUint16(offset, true)); break;
            case 5125: elem.push(view.getUint32(offset, true)); break;
            case 5126: elem.push(view.getFloat32(offset, true)); break;
          }
        }
        result.push(components === 1 ? elem[0] : elem);
      }

      return result;
    };

    for (const mesh of meshes) {
      for (const primitive of mesh.primitives) {
        const positionAccessor = primitive.attributes.POSITION;
        const positions = readAccessor(positionAccessor);
        
        const vertexStart = vertices.length;
        for (const pos of positions) {
          vertices.push([pos[0], pos[1], pos[2]]);
        }

        if (primitive.indices !== undefined) {
          const indices = readAccessor(primitive.indices);
          for (let i = 0; i < indices.length; i += 3) {
            faces.push([
              { vertex: vertexStart + indices[i] },
              { vertex: vertexStart + indices[i + 1] },
              { vertex: vertexStart + indices[i + 2] }
            ]);
          }
        } else {
          for (let i = 0; i < positions.length; i += 3) {
            faces.push([
              { vertex: vertexStart + i },
              { vertex: vertexStart + i + 1 },
              { vertex: vertexStart + i + 2 }
            ]);
          }
        }
      }
    }

    return { vertices, faces, normals: [], uvs: [] };
  }

  load(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.obj') {
      return this.loadOBJ(filePath);
    } else if (ext === '.gltf' || ext === '.glb') {
      return this.loadGLTF(filePath);
    }
    throw new Error('Unsupported file format: ' + ext);
  }
}

module.exports = ModelLoader;
