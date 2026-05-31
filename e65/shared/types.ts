export interface PointCloudMetadata {
  id: string;
  name: string;
  format: 'las' | 'ply';
  totalPoints: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  hasRGB: boolean;
  hasIntensity: boolean;
  chunkCount: number;
  createdAt: string;
}

export interface OctreeNode {
  id: string;
  level: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  center: [number, number, number];
  pointCount: number;
  children: string[];
  lodLevels: number[];
}

export interface PointCloudChunk {
  nodeId: string;
  lodLevel: number;
  positions: Float32Array;
  colors?: Float32Array;
  intensities?: Float32Array;
  pointCount: number;
}

export type ClipRegionType = 'rectangle' | 'sphere' | 'polygon';

export interface ClipRegion {
  id: string;
  type: ClipRegionType;
  parameters: RectangleParameters | SphereParameters | PolygonParameters;
  inverse: boolean;
  visible: boolean;
}

export interface RectangleParameters {
  start: [number, number];
  end: [number, number];
}

export interface SphereParameters {
  center: [number, number, number];
  radius: number;
}

export interface PolygonParameters {
  points: [number, number][];
}

export type ColorMode = 'elevation' | 'intensity' | 'rgb' | 'uniform';

export interface PointCloudSettings {
  pointSize: number;
  colorMode: ColorMode;
  uniformColor: string;
  lodBias: number;
  maxVisiblePoints: number;
}

export type PointClassType = 'ground' | 'building' | 'vegetation' | 'unclassified';

export interface PointAnnotation {
  id: string;
  pointIndex: number;
  label: PointClassType;
  confidence?: number;
  createdAt: string;
  createdBy?: string;
}

export interface ClassificationResult {
  id: string;
  name: string;
  type: PointClassType;
  pointIndices: number[];
  color: [number, number, number];
  createdAt: string;
}

export interface CollaborativeAction {
  id: string;
  type: 'add_annotation' | 'remove_annotation' | 'add_classification' | 'remove_classification' | 'update_settings' | 'add_clip' | 'remove_clip';
  userId: string;
  userName: string;
  timestamp: number;
  payload: any;
}

export interface User {
  id: string;
  name: string;
  color: string;
  isOnline: boolean;
}

export interface AppState {
  pointCloud: PointCloudMetadata | null;
  settings: PointCloudSettings;
  clipRegions: ClipRegion[];
  activeTool: ClipRegionType | 'annotation' | 'none';
  isLoading: boolean;
  progress: number;
  stats: {
    visiblePoints: number;
    fps: number;
    memoryUsage: number;
  };
  annotations: PointAnnotation[];
  classifications: ClassificationResult[];
  activeClassification: PointClassType | null;
  users: User[];
  currentUser: User | null;
}
