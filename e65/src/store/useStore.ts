import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { 
  AppState, 
  PointCloudSettings, 
  ClipRegion, 
  PointCloudMetadata,
  PointAnnotation,
  ClassificationResult,
  PointClassType,
  User,
  CollaborativeAction,
} from '../../shared/types';

const defaultSettings: PointCloudSettings = {
  pointSize: 1.5,
  colorMode: 'elevation',
  uniformColor: '#00ffff',
  lodBias: 1.0,
  maxVisiblePoints: 2000000,
};

const initialState: AppState = {
  pointCloud: null,
  settings: defaultSettings,
  clipRegions: [],
  activeTool: 'none',
  isLoading: false,
  progress: 0,
  stats: {
    visiblePoints: 0,
    fps: 0,
    memoryUsage: 0,
  },
  annotations: [],
  classifications: [],
  activeClassification: null,
  users: [],
  currentUser: null,
};

interface StoreState extends AppState {
  clipHistory: ClipRegion[][];
  historyIndex: number;
}

interface StoreActions {
  setPointCloud: (pointCloud: PointCloudMetadata | null) => void;
  updateSettings: (settings: Partial<PointCloudSettings>) => void;
  addClipRegion: (region: ClipRegion) => void;
  removeClipRegion: (id: string) => void;
  updateClipRegion: (id: string, updates: Partial<ClipRegion>) => void;
  clearClipRegions: () => void;
  undoClip: () => void;
  redoClip: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  setActiveTool: (tool: AppState['activeTool']) => void;
  setLoading: (loading: boolean) => void;
  setProgress: (progress: number) => void;
  updateStats: (stats: Partial<AppState['stats']>) => void;
  addAnnotation: (annotation: Omit<PointAnnotation, 'id' | 'createdAt'>) => void;
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;
  addClassification: (classification: Omit<ClassificationResult, 'id' | 'createdAt'>) => void;
  removeClassification: (id: string) => void;
  clearClassifications: () => void;
  setActiveClassification: (type: PointClassType | null) => void;
  exportAnnotations: () => string;
  setCurrentUser: (user: User) => void;
  addUser: (user: User) => void;
  removeUser: (userId: string) => void;
  applyRemoteAction: (action: CollaborativeAction) => void;
  createAction: (type: CollaborativeAction['type'], payload: any) => CollaborativeAction;
}

const MAX_HISTORY_SIZE = 50;

export const useStore = create<StoreState & StoreActions>((set, get) => ({
  ...initialState,
  clipHistory: [[]],
  historyIndex: 0,

  setPointCloud: (pointCloud) => set({ pointCloud }),

  updateSettings: (settings) =>
    set((state) => ({
      settings: { ...state.settings, ...settings },
    })),

  addClipRegion: (region) =>
    set((state) => {
      const newRegions = [...state.clipRegions, region];
      const newHistory = state.clipHistory.slice(0, state.historyIndex + 1);
      newHistory.push([...newRegions]);
      
      return {
        clipRegions: newRegions,
        clipHistory: newHistory.slice(-MAX_HISTORY_SIZE),
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY_SIZE - 1),
      };
    }),

  removeClipRegion: (id) =>
    set((state) => {
      const newRegions = state.clipRegions.filter((r) => r.id !== id);
      const newHistory = state.clipHistory.slice(0, state.historyIndex + 1);
      newHistory.push([...newRegions]);
      
      return {
        clipRegions: newRegions,
        clipHistory: newHistory.slice(-MAX_HISTORY_SIZE),
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY_SIZE - 1),
      };
    }),

  updateClipRegion: (id, updates) =>
    set((state) => {
      const newRegions = state.clipRegions.map((r) =>
        r.id === id ? { ...r, ...updates } : r
      );
      const newHistory = state.clipHistory.slice(0, state.historyIndex + 1);
      newHistory.push([...newRegions]);
      
      return {
        clipRegions: newRegions,
        clipHistory: newHistory.slice(-MAX_HISTORY_SIZE),
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY_SIZE - 1),
      };
    }),

  clearClipRegions: () =>
    set((state) => {
      const newHistory = state.clipHistory.slice(0, state.historyIndex + 1);
      newHistory.push([]);
      
      return {
        clipRegions: [],
        clipHistory: newHistory.slice(-MAX_HISTORY_SIZE),
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY_SIZE - 1),
      };
    }),

  undoClip: () =>
    set((state) => {
      if (state.historyIndex <= 0) return state;
      
      const newIndex = state.historyIndex - 1;
      const restoredRegions = state.clipHistory[newIndex] || [];
      
      return {
        clipRegions: [...restoredRegions],
        historyIndex: newIndex,
      };
    }),

  redoClip: () =>
    set((state) => {
      if (state.historyIndex >= state.clipHistory.length - 1) return state;
      
      const newIndex = state.historyIndex + 1;
      const restoredRegions = state.clipHistory[newIndex] || [];
      
      return {
        clipRegions: [...restoredRegions],
        historyIndex: newIndex,
      };
    }),

  canUndo: () => get().historyIndex > 0,

  canRedo: () => get().historyIndex < get().clipHistory.length - 1,

  setActiveTool: (tool) => set({ activeTool: tool }),

  setLoading: (loading) => set({ isLoading: loading }),

  setProgress: (progress) => set({ progress }),

  updateStats: (stats) =>
    set((state) => ({
      stats: { ...state.stats, ...stats },
    })),

  addAnnotation: (annotation) =>
    set((state) => ({
      annotations: [
        ...state.annotations,
        {
          ...annotation,
          id: uuidv4(),
          createdAt: new Date().toISOString(),
        },
      ],
    })),

  removeAnnotation: (id) =>
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== id),
    })),

  clearAnnotations: () => set({ annotations: [] }),

  addClassification: (classification) =>
    set((state) => ({
      classifications: [
        ...state.classifications,
        {
          ...classification,
          id: uuidv4(),
          createdAt: new Date().toISOString(),
        },
      ],
    })),

  removeClassification: (id) =>
    set((state) => ({
      classifications: state.classifications.filter((c) => c.id !== id),
    })),

  clearClassifications: () => set({ classifications: [] }),

  setActiveClassification: (type) => set({ activeClassification: type }),

  exportAnnotations: () => {
    const state = get();
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      pointCloud: state.pointCloud?.name,
      annotations: state.annotations,
      classifications: state.classifications.map((c) => ({
        ...c,
        pointCount: c.pointIndices.length,
      })),
    };
    return JSON.stringify(exportData, null, 2);
  },

  setCurrentUser: (user) => set({ currentUser: user }),

  addUser: (user) =>
    set((state) => {
      if (state.users.find((u) => u.id === user.id)) {
        return {
          users: state.users.map((u) =>
            u.id === user.id ? { ...u, isOnline: true } : u
          ),
        };
      }
      return { users: [...state.users, { ...user, isOnline: true }] };
    }),

  removeUser: (userId) =>
    set((state) => ({
      users: state.users.map((u) =>
        u.id === userId ? { ...u, isOnline: false } : u
      ),
    })),

  createAction: (type, payload) => {
    const state = get();
    return {
      id: uuidv4(),
      type,
      userId: state.currentUser?.id || 'anonymous',
      userName: state.currentUser?.name || 'Anonymous',
      timestamp: Date.now(),
      payload,
    };
  },

  applyRemoteAction: (action) => {
    set((state) => {
      switch (action.type) {
        case 'add_annotation':
          return {
            annotations: [...state.annotations, action.payload],
          };
        case 'remove_annotation':
          return {
            annotations: state.annotations.filter(
              (a) => a.id !== action.payload.id
            ),
          };
        case 'add_classification':
          return {
            classifications: [...state.classifications, action.payload],
          };
        case 'remove_classification':
          return {
            classifications: state.classifications.filter(
              (c) => c.id !== action.payload.id
            ),
          };
        case 'update_settings':
          return {
            settings: { ...state.settings, ...action.payload },
          };
        case 'add_clip':
          return {
            clipRegions: [...state.clipRegions, action.payload],
          };
        case 'remove_clip':
          return {
            clipRegions: state.clipRegions.filter(
              (r) => r.id !== action.payload.id
            ),
          };
        default:
          return state;
      }
    });
  },
}));
