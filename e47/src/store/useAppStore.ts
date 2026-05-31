import { create } from 'zustand';
import type {
  PostProcessSettings,
  BackgroundSettings,
  InputMode,
  SegmentationResult,
  PersonInstance,
  MultiPersonResult,
} from '../types';

interface AppState {
  inputMode: InputMode;
  isCameraActive: boolean;
  isModelLoaded: boolean;
  isProcessing: boolean;
  fps: number;
  sourceImage: HTMLImageElement | HTMLVideoElement | null;
  segmentationResult: SegmentationResult | null;
  postProcess: PostProcessSettings;
  background: BackgroundSettings;
  error: string | null;
  updateBackgroundTexture: (source: HTMLImageElement | HTMLCanvasElement) => void;

  multiPersonEnabled: boolean;
  personInstances: PersonInstance[];
  multiPersonResult: MultiPersonResult | null;
  showInstanceBorders: boolean;
  showInstanceColors: boolean;

  setInputMode: (mode: InputMode) => void;
  setCameraActive: (active: boolean) => void;
  setModelLoaded: (loaded: boolean) => void;
  setProcessing: (processing: boolean) => void;
  setFps: (fps: number) => void;
  setSourceImage: (img: HTMLImageElement | HTMLVideoElement | null) => void;
  setSegmentationResult: (result: SegmentationResult | null) => void;
  setPostProcess: (settings: Partial<PostProcessSettings>) => void;
  setBackground: (settings: Partial<BackgroundSettings>) => void;
  setError: (error: string | null) => void;
  setUpdateBackgroundTexture: (fn: (source: HTMLImageElement | HTMLCanvasElement) => void) => void;

  setMultiPersonEnabled: (enabled: boolean) => void;
  setPersonInstances: (instances: PersonInstance[]) => void;
  setMultiPersonResult: (result: MultiPersonResult | null) => void;
  toggleInstanceSelection: (trackId: number) => void;
  toggleInstanceVisibility: (trackId: number) => void;
  selectAllInstances: () => void;
  deselectAllInstances: () => void;
  setShowInstanceBorders: (show: boolean) => void;
  setShowInstanceColors: (show: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  inputMode: 'camera',
  isCameraActive: false,
  isModelLoaded: false,
  isProcessing: false,
  fps: 0,
  sourceImage: null,
  segmentationResult: null,
  postProcess: {
    featherAmount: 2,
    erodeAmount: 1,
    dilateAmount: 0,
  },
  background: {
    type: 'solid',
    color: '#3b82f6',
    blurAmount: 10,
  },
  error: null,
  updateBackgroundTexture: () => {},

  multiPersonEnabled: true,
  personInstances: [],
  multiPersonResult: null,
  showInstanceBorders: true,
  showInstanceColors: false,

  setInputMode: (mode) => set({ inputMode: mode }),
  setCameraActive: (active) => set({ isCameraActive: active }),
  setModelLoaded: (loaded) => set({ isModelLoaded: loaded }),
  setProcessing: (processing) => set({ isProcessing: processing }),
  setFps: (fps) => set({ fps }),
  setSourceImage: (img) => set({ sourceImage: img }),
  setSegmentationResult: (result) => set({ segmentationResult: result }),
  setPostProcess: (settings) =>
    set((state) => ({
      postProcess: { ...state.postProcess, ...settings },
    })),
  setBackground: (settings) =>
    set((state) => ({
      background: { ...state.background, ...settings },
    })),
  setError: (error) => set({ error }),
  setUpdateBackgroundTexture: (fn) => set({ updateBackgroundTexture: fn }),

  setMultiPersonEnabled: (enabled) => set({ multiPersonEnabled: enabled }),
  setPersonInstances: (instances) => set({ personInstances: instances }),
  setMultiPersonResult: (result) => set({ multiPersonResult: result }),
  toggleInstanceSelection: (trackId) =>
    set((state) => ({
      personInstances: state.personInstances.map((inst) =>
        inst.trackId === trackId ? { ...inst, isSelected: !inst.isSelected } : inst
      ),
    })),
  toggleInstanceVisibility: (trackId) =>
    set((state) => ({
      personInstances: state.personInstances.map((inst) =>
        inst.trackId === trackId ? { ...inst, isVisible: !inst.isVisible } : inst
      ),
    })),
  selectAllInstances: () =>
    set((state) => ({
      personInstances: state.personInstances.map((inst) => ({ ...inst, isSelected: true })),
    })),
  deselectAllInstances: () =>
    set((state) => ({
      personInstances: state.personInstances.map((inst) => ({ ...inst, isSelected: false })),
    })),
  setShowInstanceBorders: (show) => set({ showInstanceBorders: show }),
  setShowInstanceColors: (show) => set({ showInstanceColors: show }),
}));
