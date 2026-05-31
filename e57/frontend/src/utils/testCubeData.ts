import { CubeData } from './cubeParser';

export function generateGaussianCube(): CubeData {
  const nx = 40;
  const ny = 40;
  const nz = 40;
  const step = 0.3;

  const values = new Float32Array(nx * ny * nz);

  const centers = [
    { x: nx / 2, y: ny / 2, z: nz / 2, sigma: 8 },
    { x: nx / 2 + 8, y: ny / 2, z: nz / 2, sigma: 6 },
    { x: nx / 2 - 8, y: ny / 2, z: nz / 2, sigma: 6 },
  ];

  let minValue = Infinity;
  let maxValue = -Infinity;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        let value = 0;
        centers.forEach(center => {
          const dx = x - center.x;
          const dy = y - center.y;
          const dz = z - center.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          value += Math.exp(-distSq / (2 * center.sigma * center.sigma));
        });

        const idx = x + y * nx + z * nx * ny;
        values[idx] = value;
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }
    }
  }

  return {
    atoms: [
      { element: 6, x: nx * step / 2, y: ny * step / 2, z: nz * step / 2 },
    ],
    origin: { x: 0, y: 0, z: 0 },
    dimensions: { nx, ny, nz },
    voxelSize: { x: step, y: step, z: step },
    values,
    minValue,
    maxValue
  };
}

export function generateOrbitalCube(): CubeData {
  const nx = 50;
  const ny = 50;
  const nz = 50;
  const step = 0.25;

  const values = new Float32Array(nx * ny * nz);

  const cx = nx / 2;
  const cy = ny / 2;
  const cz = nz / 2;

  let minValue = Infinity;
  let maxValue = -Infinity;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const dx = (x - cx) * step;
        const dy = (y - cy) * step;
        const dz = (z - cz) * step;
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const value = r > 0.1 ? (dz / r) * Math.exp(-r / 3) * (27 - 18 * r + 2 * r * r) / 81 : 0;

        const idx = x + y * nx + z * nx * ny;
        values[idx] = value;
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }
    }
  }

  return {
    atoms: [],
    origin: { x: -nx * step / 2, y: -ny * step / 2, z: -nz * step / 2 },
    dimensions: { nx, ny, nz },
    voxelSize: { x: step, y: step, z: step },
    values,
    minValue,
    maxValue
  };
}
