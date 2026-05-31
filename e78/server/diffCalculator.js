const ICP = require('./icp');

class DiffCalculator {
  constructor() {
    this.icp = new ICP(30, 1e-5);
    this.progressCallback = null;
  }

  setProgressCallback(callback) {
    this.progressCallback = callback;
  }

  reportProgress(step, message, percent) {
    if (this.progressCallback) {
      this.progressCallback({ step, message, percent });
    }
  }

  downsampleVertices(vertices, targetCount) {
    if (!vertices || vertices.length === 0) return [];
    if (vertices.length <= targetCount) return vertices;
    
    const step = Math.ceil(vertices.length / targetCount);
    const sampled = [];
    for (let i = 0; i < vertices.length; i += step) {
      sampled.push(vertices[i]);
    }
    return sampled;
  }

  normalizeToSameCount(vertices1, vertices2) {
    const targetCount = Math.min(vertices1.length, vertices2.length);
    const v1 = this.downsampleVertices(vertices1, targetCount);
    const v2 = this.downsampleVertices(vertices2, targetCount);
    return [v1, v2, targetCount];
  }

  computeCentroid(vertices) {
    const n = vertices.length;
    if (n === 0) return [0, 0, 0];
    
    let sumX = 0, sumY = 0, sumZ = 0;
    for (let i = 0; i < n; i++) {
      const v = vertices[i];
      if (v && v.length >= 3) {
        sumX += v[0] || 0;
        sumY += v[1] || 0;
        sumZ += v[2] || 0;
      }
    }
    return [sumX / n, sumY / n, sumZ / n];
  }

  computeBoundingBox(vertices) {
    if (!vertices || vertices.length === 0) {
      return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
    }
    
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (const v of vertices) {
      if (v && v.length >= 3) {
        minX = Math.min(minX, v[0] || 0);
        minY = Math.min(minY, v[1] || 0);
        minZ = Math.min(minZ, v[2] || 0);
        maxX = Math.max(maxX, v[0] || 0);
        maxY = Math.max(maxY, v[1] || 0);
        maxZ = Math.max(maxZ, v[2] || 0);
      }
    }
    
    return {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ]
    };
  }

  computeScale(vertices) {
    const box = this.computeBoundingBox(vertices);
    const maxDim = Math.max(box.size[0], box.size[1], box.size[2]);
    return maxDim > 0 ? maxDim : 1;
  }

  alignTranslationScale(source, target) {
    const sourceCentroid = this.computeCentroid(source);
    const targetCentroid = this.computeCentroid(target);
    
    const sourceScale = this.computeScale(source);
    const targetScale = this.computeScale(target);
    
    const scale = targetScale > 0 && sourceScale > 0 ? targetScale / sourceScale : 1;
    
    const translation = [
      targetCentroid[0] - sourceCentroid[0] * scale,
      targetCentroid[1] - sourceCentroid[1] * scale,
      targetCentroid[2] - sourceCentroid[2] * scale
    ];
    
    const aligned = source.map(v => [
      v[0] * scale + translation[0],
      v[1] * scale + translation[1],
      v[2] * scale + translation[2]
    ]);
    
    return {
      alignedSource: aligned,
      translation,
      scale
    };
  }

  simpleRegister(source, target) {
    return this.alignTranslationScale(source, target);
  }

  computeDistances(source, target) {
    const distances = [];
    const sourceLen = source.length;
    const targetLen = target.length;
    
    if (sourceLen === 0 || targetLen === 0) {
      return distances;
    }
    
    for (let i = 0; i < sourceLen; i++) {
      let minDist = Infinity;
      const s = source[i];
      
      if (!s || s.length < 3) {
        distances.push({
          index: i,
          vertex: [0, 0, 0],
          distance: 0
        });
        continue;
      }
      
      for (let j = 0; j < targetLen; j++) {
        const t = target[j];
        if (!t || t.length < 3) continue;
        
        const dist = this.euclideanDistance(s, t);
        if (dist < minDist) {
          minDist = dist;
        }
      }
      
      distances.push({
        index: i,
        vertex: [s[0] || 0, s[1] || 0, s[2] || 0],
        distance: isFinite(minDist) ? minDist : 0
      });
    }
    
    return distances;
  }

  euclideanDistance(a, b) {
    const dx = (a[0] || 0) - (b[0] || 0);
    const dy = (a[1] || 0) - (b[1] || 0);
    const dz = (a[2] || 0) - (b[2] || 0);
    const distSq = dx * dx + dy * dy + dz * dz;
    return distSq >= 0 ? Math.sqrt(distSq) : 0;
  }

  valueToColor(value, maxValue) {
    if (!isFinite(value) || !isFinite(maxValue) || maxValue <= 0) {
      return [128, 128, 128];
    }
    
    const normalized = Math.min(Math.max(value / maxValue, 0), 1);
    const hue = (1 - normalized) * 120;
    
    return this.hslToRgb(hue / 360, 1, 0.5);
  }

  hslToRgb(h, s, l) {
    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return [
      Math.round(Math.min(Math.max(r, 0), 1) * 255),
      Math.round(Math.min(Math.max(g, 0), 1) * 255),
      Math.round(Math.min(Math.max(b, 0), 1) * 255)
    ];
  }

  generateHeatmap(distances) {
    if (!distances || distances.length === 0) {
      return {
        colors: [],
        maxDistance: 0,
        minDistance: 0,
        meanDistance: 0
      };
    }
    
    const validDistances = distances.filter(d => isFinite(d.distance));
    if (validDistances.length === 0) {
      return {
        colors: distances.map(d => ({ index: d.index, color: [128, 128, 128] })),
        maxDistance: 0,
        minDistance: 0,
        meanDistance: 0
      };
    }
    
    const maxDist = Math.max(...validDistances.map(d => d.distance));
    const minDist = Math.min(...validDistances.map(d => d.distance));
    const range = maxDist - minDist;
    
    const mean = validDistances.reduce((sum, d) => sum + d.distance, 0) / validDistances.length;

    const colors = distances.map(d => ({
      index: d.index,
      color: range > 0 && isFinite(d.distance)
        ? this.valueToColor(d.distance - minDist, range)
        : [128, 128, 128]
    }));

    return {
      colors,
      maxDistance: isFinite(maxDist) ? maxDist : 0,
      minDistance: isFinite(minDist) ? minDist : 0,
      meanDistance: isFinite(mean) ? mean : 0
    };
  }

  getTopDifferences(distances, count = 5) {
    if (!distances || distances.length === 0) {
      const result = [];
      for (let i = 0; i < count; i++) {
        result.push({
          index: i,
          vertex: [0, 0, 0],
          distance: 0
        });
      }
      return result;
    }
    
    const sorted = [...distances]
      .filter(d => isFinite(d.distance))
      .sort((a, b) => b.distance - a.distance);
    
    const result = [];
    const maxItems = Math.min(count, sorted.length);
    
    for (let i = 0; i < maxItems; i++) {
      result.push({
        index: sorted[i].index,
        vertex: [
          isFinite(sorted[i].vertex[0]) ? sorted[i].vertex[0] : 0,
          isFinite(sorted[i].vertex[1]) ? sorted[i].vertex[1] : 0,
          isFinite(sorted[i].vertex[2]) ? sorted[i].vertex[2] : 0
        ],
        distance: sorted[i].distance
      });
    }
    
    while (result.length < count) {
      result.push({
        index: result.length,
        vertex: [0, 0, 0],
        distance: 0
      });
    }
    
    return result;
  }

  calculate(model1, model2, options = {}) {
    const { 
      sampleCount = 10000, 
      useICP = true, 
      alignMethod = 'icp'
    } = options;

    this.reportProgress(1, '加载模型中...', 10);

    if (!model1 || !model1.vertices || !model2 || !model2.vertices) {
      throw new Error('模型数据无效');
    }

    this.reportProgress(2, '下采样顶点...', 20);
    
    let vertices1 = this.downsampleVertices(model1.vertices, sampleCount);
    let vertices2 = this.downsampleVertices(model2.vertices, sampleCount);
    
    this.reportProgress(3, '统一顶点数量...', 30);
    
    [vertices1, vertices2] = this.normalizeToSameCount(vertices1, vertices2);

    let transformedSource = vertices1;
    let transform = null;

    if (useICP) {
      if (alignMethod === 'simple') {
        this.reportProgress(4, '执行平移+缩放对齐...', 50);
        const result = this.simpleRegister(vertices1, vertices2);
        transformedSource = result.alignedSource;
        transform = {
          translation: result.translation,
          scale: result.scale,
          method: 'simple'
        };
      } else {
        this.reportProgress(4, '执行ICP配准（平移+旋转）...', 50);
        const result = this.icp.register(vertices1, vertices2);
        transformedSource = result.transformedSource;
        transform = {
          rotation: result.rotation,
          translation: result.translation,
          method: 'icp'
        };
      }
    }

    this.reportProgress(5, '计算顶点差异...', 75);
    
    const distances = this.computeDistances(transformedSource, vertices2);
    
    this.reportProgress(6, '生成热力图...', 85);
    
    const heatmap = this.generateHeatmap(distances);
    
    this.reportProgress(7, '提取Top差异顶点...', 95);
    
    const topDiff = this.getTopDifferences(distances, 5);
    
    this.reportProgress(8, '完成！', 100);

    return {
      transform,
      distances,
      heatmap,
      topDifferences: topDiff,
      stats: {
        minDistance: heatmap.minDistance,
        maxDistance: heatmap.maxDistance,
        meanDistance: heatmap.meanDistance,
        vertexCount1: model1.vertices.length,
        vertexCount2: model2.vertices.length,
        sampledCount1: vertices1.length,
        sampledCount2: vertices2.length
      }
    };
  }
}

module.exports = DiffCalculator;
