export interface Dimensions {
  width: number;
  height: number;
}

export interface PostProcessSettings {
  featherAmount: number;
  erodeAmount: number;
  dilateAmount: number;
}

export interface BackgroundSettings {
  type: 'solid' | 'blur' | 'image';
  color: string;
  blurAmount: number;
  imageUrl?: string;
}

export type InputMode = 'camera' | 'image';

export interface SegmentationResult {
  alphaData: Uint8ClampedArray;
  dimensions: Dimensions;
  inferenceTime: number;
}

export interface WorkerMessage {
  type: 'load' | 'segment' | 'cancel';
  payload?: any;
}

export interface WorkerResponse {
  type: 'loaded' | 'result' | 'error' | 'progress';
  payload?: any;
}

export interface WebGLTextures {
  input: WebGLTexture | null;
  alpha: WebGLTexture | null;
  background: WebGLTexture | null;
}

export interface PersonInstance {
  id: number;
  trackId: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  area: number;
  maskData: Uint8ClampedArray;
  isSelected: boolean;
  isVisible: boolean;
  color: { r: number; g: number; b: number };
}

export interface ConnectedComponent {
  pixels: Array<{ x: number; y: number }>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  area: number;
}

export interface MultiPersonResult {
  instances: PersonInstance[];
  combinedMask: Uint8ClampedArray;
  dimensions: Dimensions;
  inferenceTime: number;
}
