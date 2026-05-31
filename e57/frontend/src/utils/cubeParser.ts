export interface CubeData {
  atoms: Array<{
    element: number;
    x: number;
    y: number;
    z: number;
  }>;
  origin: { x: number; y: number; z: number };
  dimensions: { nx: number; ny: number; nz: number };
  voxelSize: { x: number; y: number; z: number };
  values: Float32Array;
  minValue: number;
  maxValue: number;
}

export function parseCubeFile(content: string): CubeData {
  const lines = content.trim().split('\n');
  let lineIndex = 0;

  while (lineIndex < lines.length && lines[lineIndex].trim() === '') {
    lineIndex++;
  }

  lineIndex += 2;

  const headerLine = lines[lineIndex++].trim().split(/\s+/);
  const atomCount = Math.abs(parseInt(headerLine[0]));
  const originX = parseFloat(headerLine[1]);
  const originY = parseFloat(headerLine[2]);
  const originZ = parseFloat(headerLine[3]);

  const nxLine = lines[lineIndex++].trim().split(/\s+/);
  const nyLine = lines[lineIndex++].trim().split(/\s+/);
  const nzLine = lines[lineIndex++].trim().split(/\s+/);

  const nx = parseInt(nxLine[0]);
  const ny = parseInt(nyLine[0]);
  const nz = parseInt(nzLine[0]);

  const voxelX = parseFloat(nxLine[1]);
  const voxelY = parseFloat(nyLine[2]);
  const voxelZ = parseFloat(nzLine[3]);

  const atoms: CubeData['atoms'] = [];
  for (let i = 0; i < atomCount; i++) {
    const parts = lines[lineIndex++].trim().split(/\s+/);
    atoms.push({
      element: parseInt(parts[0]),
      x: parseFloat(parts[2]),
      y: parseFloat(parts[3]),
      z: parseFloat(parts[4])
    });
  }

  const values: number[] = [];
  while (lineIndex < lines.length && values.length < nx * ny * nz) {
    const lineValues = lines[lineIndex++].trim().split(/\s+/)
      .filter(v => v !== '')
      .map(v => parseFloat(v));
    values.push(...lineValues);
  }

  const floatValues = new Float32Array(values);

  let minValue = Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i < floatValues.length; i++) {
    minValue = Math.min(minValue, floatValues[i]);
    maxValue = Math.max(maxValue, floatValues[i]);
  }

  return {
    atoms,
    origin: { x: originX, y: originY, z: originZ },
    dimensions: { nx, ny, nz },
    voxelSize: { x: voxelX, y: voxelY, z: voxelZ },
    values: floatValues,
    minValue,
    maxValue
  };
}
