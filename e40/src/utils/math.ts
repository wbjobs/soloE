import { Vec3 } from '../types';

export const vec3 = {
  create(x = 0, y = 0, z = 0): Vec3 {
    return { x, y, z };
  },

  add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  },

  sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  },

  scale(v: Vec3, s: number): Vec3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  },

  dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  },

  cross(a: Vec3, b: Vec3): Vec3 {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  },

  length(v: Vec3): number {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  },

  normalize(v: Vec3): Vec3 {
    const len = this.length(v);
    if (len === 0) return { x: 0, y: 0, z: 0 };
    return this.scale(v, 1 / len);
  },

  lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t
    };
  }
};

export class Matrix4 {
  private data: Float32Array;

  constructor() {
    this.data = new Float32Array(16);
    this.identity();
  }

  identity(): this {
    this.data.fill(0);
    this.data[0] = 1;
    this.data[5] = 1;
    this.data[10] = 1;
    this.data[15] = 1;
    return this;
  }

  perspective(fov: number, aspect: number, near: number, far: number): this {
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    this.data.fill(0);
    this.data[0] = f / aspect;
    this.data[5] = f;
    this.data[10] = (far + near) * nf;
    this.data[11] = -1;
    this.data[14] = 2 * far * near * nf;
    return this;
  }

  lookAt(eye: Vec3, target: Vec3, up: Vec3): this {
    const z = vec3.normalize(vec3.sub(eye, target));
    const x = vec3.normalize(vec3.cross(up, z));
    const y = vec3.cross(z, x);

    this.data[0] = x.x;
    this.data[1] = y.x;
    this.data[2] = z.x;
    this.data[3] = 0;
    this.data[4] = x.y;
    this.data[5] = y.y;
    this.data[6] = z.y;
    this.data[7] = 0;
    this.data[8] = x.z;
    this.data[9] = y.z;
    this.data[10] = z.z;
    this.data[11] = 0;
    this.data[12] = -vec3.dot(x, eye);
    this.data[13] = -vec3.dot(y, eye);
    this.data[14] = -vec3.dot(z, eye);
    this.data[15] = 1;
    return this;
  }

  multiply(other: Matrix4): this {
    const a = this.data;
    const b = other.data;
    const result = new Float32Array(16);
    
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        result[i * 4 + j] = 
          a[i * 4 + 0] * b[0 * 4 + j] +
          a[i * 4 + 1] * b[1 * 4 + j] +
          a[i * 4 + 2] * b[2 * 4 + j] +
          a[i * 4 + 3] * b[3 * 4 + j];
      }
    }
    
    this.data = result;
    return this;
  }

  translate(v: Vec3): this {
    const m = new Matrix4();
    m.data[12] = v.x;
    m.data[13] = v.y;
    m.data[14] = v.z;
    return this.multiply(m);
  }

  rotateY(angle: number): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const m = new Matrix4();
    m.data[0] = c;
    m.data[2] = s;
    m.data[8] = -s;
    m.data[10] = c;
    return this.multiply(m);
  }

  rotateX(angle: number): this {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const m = new Matrix4();
    m.data[5] = c;
    m.data[6] = -s;
    m.data[9] = s;
    m.data[10] = c;
    return this.multiply(m);
  }

  toArray(): Float32Array {
    return this.data;
  }
}
