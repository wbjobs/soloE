import * as THREE from 'three';
import { PointCloudChunk } from '../../shared/types';

export class PointCloudParser {
  static async parseLAS(file: File): Promise<{
    positions: Float32Array;
    colors?: Float32Array;
    intensities?: Float32Array;
    pointCount: number;
    bounds: {
      min: [number, number, number];
      max: [number, number, number];
    };
  }> {
    const arrayBuffer = await file.arrayBuffer();
    const dataView = new DataView(arrayBuffer);

    const signature = this.readString(dataView, 0, 4);
    if (signature !== 'LASF') {
      throw new Error('Invalid LAS file format');
    }

    const fileSourceId = dataView.getUint16(4, true);
    const globalEncoding = dataView.getUint16(6, true);
    const versionMajor = dataView.getUint8(24);
    const versionMinor = dataView.getUint8(25);

    const headerSize = dataView.getUint16(94, true);
    const offsetToPointData = dataView.getUint32(96, true);
    const numberOfVLRs = dataView.getUint32(100, true);
    const pointDataRecordFormat = dataView.getUint8(104);
    const pointDataRecordLength = dataView.getUint16(105, true);
    const numberOfPoints = dataView.getUint32(107, true);

    const scaleX = dataView.getFloat64(131, true);
    const scaleY = dataView.getFloat64(139, true);
    const scaleZ = dataView.getFloat64(147, true);

    const offsetX = dataView.getFloat64(155, true);
    const offsetY = dataView.getFloat64(163, true);
    const offsetZ = dataView.getFloat64(171, true);

    const maxX = dataView.getFloat64(179, true);
    const minX = dataView.getFloat64(187, true);
    const maxY = dataView.getFloat64(195, true);
    const minY = dataView.getFloat64(203, true);
    const maxZ = dataView.getFloat64(211, true);
    const minZ = dataView.getFloat64(219, true);

    const positions = new Float32Array(numberOfPoints * 3);
    const intensities = pointDataRecordFormat >= 1 ? new Float32Array(numberOfPoints) : undefined;
    const colors = pointDataRecordFormat >= 2 ? new Float32Array(numberOfPoints * 3) : undefined;

    for (let i = 0; i < numberOfPoints; i++) {
      const offset = offsetToPointData + i * pointDataRecordLength;

      const x = dataView.getInt32(offset, true) * scaleX + offsetX;
      const y = dataView.getInt32(offset + 4, true) * scaleY + offsetY;
      const z = dataView.getInt32(offset + 8, true) * scaleZ + offsetZ;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      if (intensities) {
        intensities[i] = dataView.getUint16(offset + 12, true) / 65535;
      }

      if (colors && pointDataRecordFormat >= 2) {
        const colorOffset = pointDataRecordFormat === 2 ? 20 : 28;
        colors[i * 3] = dataView.getUint16(offset + colorOffset, true) / 65535;
        colors[i * 3 + 1] = dataView.getUint16(offset + colorOffset + 2, true) / 65535;
        colors[i * 3 + 2] = dataView.getUint16(offset + colorOffset + 4, true) / 65535;
      }
    }

    return {
      positions,
      colors,
      intensities,
      pointCount: numberOfPoints,
      bounds: {
        min: [minX, minY, minZ] as [number, number, number],
        max: [maxX, maxY, maxZ] as [number, number, number],
      },
    };
  }

  static async parsePLY(file: File): Promise<{
    positions: Float32Array;
    colors?: Float32Array;
    intensities?: Float32Array;
    pointCount: number;
    bounds: {
      min: [number, number, number];
      max: [number, number, number];
    };
  }> {
    const text = await file.text();
    const lines = text.split('\n');

    let inHeader = true;
    let pointCount = 0;
    let dataStartIndex = 0;
    const properties: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line === 'end_header') {
        inHeader = false;
        dataStartIndex = i + 1;
        break;
      }

      if (inHeader) {
        if (line.startsWith('element vertex')) {
          pointCount = parseInt(line.split(' ')[2]);
        }
        if (line.startsWith('property')) {
          properties.push(line.split(' ').pop() || '');
        }
      }
    }

    const positions = new Float32Array(pointCount * 3);
    const colors = properties.includes('red') ? new Float32Array(pointCount * 3) : undefined;
    const intensities = properties.includes('intensity') ? new Float32Array(pointCount) : undefined;

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let i = 0; i < pointCount; i++) {
      const values = lines[dataStartIndex + i].trim().split(/\s+/);

      const x = parseFloat(values[properties.indexOf('x')]);
      const y = parseFloat(values[properties.indexOf('y')]);
      const z = parseFloat(values[properties.indexOf('z')]);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);

      if (colors) {
        colors[i * 3] = parseInt(values[properties.indexOf('red')]) / 255;
        colors[i * 3 + 1] = parseInt(values[properties.indexOf('green')]) / 255;
        colors[i * 3 + 2] = parseInt(values[properties.indexOf('blue')]) / 255;
      }

      if (intensities) {
        intensities[i] = parseFloat(values[properties.indexOf('intensity')]);
      }
    }

    return {
      positions,
      colors,
      intensities,
      pointCount,
      bounds: {
        min: [minX, minY, minZ] as [number, number, number],
        max: [maxX, maxY, maxZ] as [number, number, number],
      },
    };
  }

  static generateElevationColors(
    positions: Float32Array,
    bounds: { min: [number, number, number]; max: [number, number, number] }
  ): Float32Array {
    const colors = new Float32Array(positions.length);
    const heightRange = bounds.max[1] - bounds.min[1];

    for (let i = 0; i < positions.length / 3; i++) {
      const y = positions[i * 3 + 1];
      const normalizedHeight = (y - bounds.min[1]) / heightRange;

      const color = new THREE.Color();
      color.setHSL(0.65 * (1 - normalizedHeight), 0.8, 0.5);

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    return colors;
  }

  static downsamplePointCloud(
    positions: Float32Array,
    colors: Float32Array | undefined,
    intensities: Float32Array | undefined,
    factor: number
  ): PointCloudChunk {
    const originalCount = positions.length / 3;
    const sampleCount = Math.floor(originalCount / factor);

    const sampledPositions = new Float32Array(sampleCount * 3);
    const sampledColors = colors && colors.length > 0 ? new Float32Array(sampleCount * 3) : undefined;
    const sampledIntensities = intensities && intensities.length > 0 ? new Float32Array(sampleCount) : undefined;

    for (let i = 0; i < sampleCount; i++) {
      const srcIdx = i * factor;
      const dstPosIdx = i * 3;
      const srcPosIdx = srcIdx * 3;

      sampledPositions[dstPosIdx] = positions[srcPosIdx];
      sampledPositions[dstPosIdx + 1] = positions[srcPosIdx + 1];
      sampledPositions[dstPosIdx + 2] = positions[srcPosIdx + 2];

      if (sampledColors && colors) {
        sampledColors[dstPosIdx] = colors[srcPosIdx] || 0.5;
        sampledColors[dstPosIdx + 1] = colors[srcPosIdx + 1] || 0.5;
        sampledColors[dstPosIdx + 2] = colors[srcPosIdx + 2] || 0.5;
      }

      if (sampledIntensities && intensities) {
        sampledIntensities[i] = intensities[srcIdx] || 0.5;
      }
    }

    return {
      nodeId: 'downsampled',
      lodLevel: Math.log2(factor),
      positions: sampledPositions,
      colors: sampledColors,
      intensities: sampledIntensities,
      pointCount: sampleCount,
    };
  }

  private static readString(dataView: DataView, offset: number, length: number): string {
    let str = '';
    for (let i = 0; i < length; i++) {
      const charCode = dataView.getUint8(offset + i);
      if (charCode === 0) break;
      str += String.fromCharCode(charCode);
    }
    return str;
  }
}
