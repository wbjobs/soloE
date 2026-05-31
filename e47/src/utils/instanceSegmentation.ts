import type { PersonInstance, ConnectedComponent, Dimensions } from '../types';

const MIN_AREA_THRESHOLD = 500;
const PERSON_COLORS = [
  { r: 31, g: 119, b: 180 },
  { r: 255, g: 127, b: 14 },
  { r: 44, g: 160, b: 44 },
  { r: 214, g: 39, b: 40 },
  { r: 148, g: 103, b: 189 },
  { r: 140, g: 86, b: 75 },
  { r: 227, g: 119, b: 194 },
  { r: 127, g: 127, b: 127 },
];

export function findConnectedComponents(
  maskData: Uint8ClampedArray,
  width: number,
  height: number
): ConnectedComponent[] {
  const components: ConnectedComponent[] = [];
  const visited = new Uint8Array(width * height);
  const threshold = 127;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const pixelIdx = idx * 4;
      
      if (visited[idx] || maskData[pixelIdx] < threshold) {
        continue;
      }

      const component = floodFill(maskData, width, height, x, y, visited, threshold);
      
      if (component.area >= MIN_AREA_THRESHOLD) {
        components.push(component);
      }
    }
  }

  return components.sort((a, b) => b.area - a.area);
}

function floodFill(
  maskData: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Uint8Array,
  threshold: number
): ConnectedComponent {
  const stack: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  const pixels: Array<{ x: number; y: number }> = [];
  
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    const idx = y * width + x;
    const pixelIdx = idx * 4;

    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    if (visited[idx]) continue;
    if (maskData[pixelIdx] < threshold) continue;

    visited[idx] = 1;
    pixels.push({ x, y });

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    stack.push({ x: x + 1, y });
    stack.push({ x: x - 1, y });
    stack.push({ x, y: y + 1 });
    stack.push({ x, y: y - 1 });
  }

  return {
    pixels,
    minX,
    maxX,
    minY,
    maxY,
    area: pixels.length,
  };
}

export function createPersonInstances(
  components: ConnectedComponent[],
  maskData: Uint8ClampedArray,
  dimensions: Dimensions
): PersonInstance[] {
  return components.map((component, index) => {
    const { width, height } = dimensions;
    const mask = new Uint8ClampedArray(width * height * 4);
    
    for (const { x, y } of component.pixels) {
      const idx = (y * width + x) * 4;
      mask[idx] = 255;
      mask[idx + 1] = 255;
      mask[idx + 2] = 255;
      mask[idx + 3] = 255;
    }

    const boxWidth = component.maxX - component.minX + 1;
    const boxHeight = component.maxY - component.minY + 1;

    return {
      id: index,
      trackId: -1,
      boundingBox: {
        x: component.minX,
        y: component.minY,
        width: boxWidth,
        height: boxHeight,
      },
      center: {
        x: component.minX + boxWidth / 2,
        y: component.minY + boxHeight / 2,
      },
      area: component.area,
      maskData: mask,
      isSelected: true,
      isVisible: true,
      color: PERSON_COLORS[index % PERSON_COLORS.length],
    };
  });
}

export function hungarianAlgorithm(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  const m = costMatrix[0]?.length || 0;
  
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= m; j++) {
        if (!used[j]) {
          const cur = costMatrix[i0 - 1]?.[j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }

      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) {
      result[p[j] - 1] = j - 1;
    }
  }

  return result;
}

export function calculateCentroidDistance(
  prevInstance: PersonInstance,
  currInstance: PersonInstance
): number {
  const dx = prevInstance.center.x - currInstance.center.x;
  const dy = prevInstance.center.y - currInstance.center.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function calculateIoU(
  prevInstance: PersonInstance,
  currInstance: PersonInstance
): number {
  const prevBox = prevInstance.boundingBox;
  const currBox = currInstance.boundingBox;

  const x1 = Math.max(prevBox.x, currBox.x);
  const y1 = Math.max(prevBox.y, currBox.y);
  const x2 = Math.min(prevBox.x + prevBox.width, currBox.x + currBox.width);
  const y2 = Math.min(prevBox.y + prevBox.height, currBox.y + currBox.height);

  if (x2 <= x1 || y2 <= y1) return 0;

  const intersection = (x2 - x1) * (y2 - y1);
  const union = prevBox.width * prevBox.height + currBox.width * currBox.height - intersection;

  return intersection / union;
}

export function buildCostMatrix(
  prevInstances: PersonInstance[],
  currInstances: PersonInstance[]
): number[][] {
  const matrix: number[][] = [];

  for (const curr of currInstances) {
    const row: number[] = [];
    for (const prev of prevInstances) {
      const distance = calculateCentroidDistance(prev, curr);
      const iou = calculateIoU(prev, curr);
      const cost = distance * (1 - iou) * 100;
      row.push(cost);
    }
    matrix.push(row);
  }

  return matrix;
}

let nextTrackId = 1;
const MAX_DISTANCE_THRESHOLD = 100;

export function trackInstances(
  prevInstances: PersonInstance[],
  currInstances: PersonInstance[]
): PersonInstance[] {
  if (prevInstances.length === 0) {
    return currInstances.map((instance) => ({
      ...instance,
      trackId: nextTrackId++,
    }));
  }

  if (currInstances.length === 0) {
    return [];
  }

  const costMatrix = buildCostMatrix(prevInstances, currInstances);
  const assignments = hungarianAlgorithm(costMatrix);

  const result: PersonInstance[] = [];
  const usedPrevIds = new Set<number>();

  for (let i = 0; i < currInstances.length; i++) {
    const currInstance = currInstances[i];
    const prevIdx = assignments[i];

    if (prevIdx >= 0 && prevIdx < prevInstances.length) {
      const distance = calculateCentroidDistance(prevInstances[prevIdx], currInstance);
      
      if (distance < MAX_DISTANCE_THRESHOLD) {
        result.push({
          ...currInstance,
          trackId: prevInstances[prevIdx].trackId,
          isSelected: prevInstances[prevIdx].isSelected,
          isVisible: prevInstances[prevIdx].isVisible,
          color: prevInstances[prevIdx].color,
        });
        usedPrevIds.add(prevInstances[prevIdx].trackId);
      } else {
        result.push({
          ...currInstance,
          trackId: nextTrackId++,
        });
      }
    } else {
      result.push({
        ...currInstance,
        trackId: nextTrackId++,
      });
    }
  }

  return result;
}

export function buildCombinedMask(
  instances: PersonInstance[],
  dimensions: Dimensions
): Uint8ClampedArray {
  const { width, height } = dimensions;
  const mask = new Uint8ClampedArray(width * height * 4);

  for (const instance of instances) {
    if (!instance.isVisible || !instance.isSelected) continue;
    
    for (let y = instance.boundingBox.y; y < instance.boundingBox.y + instance.boundingBox.height; y++) {
      for (let x = instance.boundingBox.x; x < instance.boundingBox.x + instance.boundingBox.width; x++) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        
        const idx = (y * width + x) * 4;
        const instanceMaskIdx = idx;
        
        if (instance.maskData[instanceMaskIdx] > 0) {
          mask[idx] = 255;
          mask[idx + 1] = 255;
          mask[idx + 2] = 255;
          mask[idx + 3] = 255;
        }
      }
    }
  }

  return mask;
}

export function findInstanceAtPoint(
  instances: PersonInstance[],
  x: number,
  y: number
): PersonInstance | null {
  for (const instance of instances) {
    const { x: bx, y: by, width: bw, height: bh } = instance.boundingBox;
    
    if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
      const localX = x - bx;
      const localY = y - by;
      const idx = (localY * bw + localX) * 4;
      
      if (instance.maskData[idx] > 127) {
        return instance;
      }
    }
  }
  return null;
}

export function resetTrackIdCounter(): void {
  nextTrackId = 1;
}