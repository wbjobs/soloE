import { VoxelData, Vec3 } from '../types';

export function generateVoxelScene(
  width: number = 128,
  height: number = 128,
  depth: number = 128,
  sceneType: 'sphere' | 'maze' | 'terrain' | 'checkerboard' = 'sphere'
): VoxelData {
  const size = width * height * depth;
  const data = new Uint8Array(size);

  const cx = width / 2;
  const cy = height / 2;
  const cz = depth / 2;

  for (let z = 0; z < depth; z++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = z * width * height + y * width + x;
        let value = 0;

        switch (sceneType) {
          case 'sphere':
            value = generateSphere(x, y, z, cx, cy, cz, Math.min(width, height, depth) * 0.4);
            break;
          case 'maze':
            value = generateMaze(x, y, z);
            break;
          case 'terrain':
            value = generateTerrain(x, y, z, height);
            break;
          case 'checkerboard':
            value = generateCheckerboard(x, y, z);
            break;
        }

        data[idx] = value;
      }
    }
  }

  return { width, height, depth, data };
}

function generateSphere(x: number, y: number, z: number, cx: number, cy: number, cz: number, radius: number): number {
  const dx = x - cx;
  const dy = y - cy;
  const dz = z - cz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist < radius - 2) {
    return Math.floor(100 + Math.sin(x * 0.3) * 50 + Math.cos(y * 0.2) * 50);
  } else if (dist < radius) {
    return 50;
  }
  return 0;
}

function generateMaze(x: number, y: number, z: number): number {
  const cellSize = 8;
  const gx = Math.floor(x / cellSize);
  const gy = Math.floor(y / cellSize);
  const gz = Math.floor(z / cellSize);

  const lx = x % cellSize;
  const ly = y % cellSize;
  const lz = z % cellSize;

  const isWall =
    (gx + gy + gz) % 2 === 0 &&
    lx > 1 && lx < cellSize - 1 &&
    ly > 1 && ly < cellSize - 1 &&
    lz > 1 && lz < cellSize - 1;

  if (isWall) {
    return Math.floor(80 + ((gx * 31 + gy * 17 + gz * 13) % 100));
  }
  return 0;
}

function generateTerrain(x: number, y: number, z: number, h: number): number {
  const height =
    Math.sin(x * 0.1) * 15 +
    Math.cos(z * 0.1) * 15 +
    Math.sin(x * 0.05 + z * 0.05) * 25 +
    h / 2;

  if (y < height - 5) {
    return 120;
  } else if (y < height) {
    return 80;
  }
  return 0;
}

function generateCheckerboard(x: number, y: number, z: number): number {
  const size = 16;
  const gx = Math.floor(x / size);
  const gy = Math.floor(y / size);
  const gz = Math.floor(z / size);

  if ((gx + gy + gz) % 2 === 0) {
    return Math.floor(100 + ((gx * 7 + gy * 5 + gz * 3) % 50));
  }
  return 0;
}

export function getVoxelColor(value: number): Vec3 {
  if (value === 0) return { x: 0, y: 0, z: 0 };

  const normalized = value / 255;
  return {
    x: Math.sin(normalized * Math.PI * 2) * 0.5 + 0.5,
    y: Math.sin(normalized * Math.PI * 2 + 2) * 0.5 + 0.5,
    z: Math.sin(normalized * Math.PI * 2 + 4) * 0.5 + 0.5,
  };
}
