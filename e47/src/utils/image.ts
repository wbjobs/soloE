import type { Dimensions } from '../types';

export function getImageData(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  targetDimensions: Dimensions
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = targetDimensions.width;
  canvas.height = targetDimensions.height;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');
  
  ctx.drawImage(source, 0, 0, targetDimensions.width, targetDimensions.height);
  
  return ctx.getImageData(0, 0, targetDimensions.width, targetDimensions.height);
}

export function preprocessImage(
  imageData: ImageData,
  mean: [number, number, number] = [0.485, 0.456, 0.406],
  std: [number, number, number] = [0.229, 0.224, 0.225]
): Float32Array {
  const { width, height, data } = imageData;
  const result = new Float32Array(3 * width * height);
  
  for (let i = 0; i < width * height; i++) {
    const pixelIdx = i * 4;
    
    result[i] = (data[pixelIdx] / 255 - mean[0]) / std[0];
    result[i + width * height] = (data[pixelIdx + 1] / 255 - mean[1]) / std[1];
    result[i + 2 * width * height] = (data[pixelIdx + 2] / 255 - mean[2]) / std[2];
  }
  
  return result;
}

export function alphaToImageData(alpha: Float32Array, dimensions: Dimensions): ImageData {
  const { width, height } = dimensions;
  const result = new Uint8ClampedArray(width * height * 4);
  
  for (let i = 0; i < width * height; i++) {
    const value = Math.max(0, Math.min(255, Math.round(alpha[i] * 255)));
    const idx = i * 4;
    result[idx] = value;
    result[idx + 1] = value;
    result[idx + 2] = value;
    result[idx + 3] = 255;
  }
  
  return new ImageData(result, width, height);
}

export function resizeImage(
  source: HTMLImageElement | HTMLVideoElement,
  targetWidth: number,
  targetHeight: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');
  
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  
  return canvas;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to convert canvas to blob'));
      }
    }, type);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
