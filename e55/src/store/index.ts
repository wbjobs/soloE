import { create } from 'zustand';
import type { DeviceInfo, TransferTask, AppSettings } from '../types';

interface AppState {
  devices: DeviceInfo[];
  transfers: TransferTask[];
  settings: AppSettings;
  isScanning: boolean;
  selectedDevice: DeviceInfo | null;
}

interface AppActions {
  setDevices: (devices: DeviceInfo[]) => void;
  addDevice: (device: DeviceInfo) => void;
  removeDevice: (deviceId: string) => void;
  updateDeviceStatus: (deviceId: string, status: DeviceInfo['status']) => void;
  setIsScanning: (scanning: boolean) => void;
  setSelectedDevice: (device: DeviceInfo | null) => void;
  addTransfer: (transfer: TransferTask) => void;
  updateTransfer: (transferId: string, updates: Partial<TransferTask>) => void;
  removeTransfer: (transferId: string) => void;
  setSettings: (settings: AppSettings) => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
}

const defaultSettings: AppSettings = {
  deviceName: 'My Device',
  savePath: '',
  autoAccept: false,
  maxConcurrentTransfers: 3,
  enableEncryption: true,
  discoveryPort: 58777,
  transferPort: 58778,
  enableHolePunch: true,
  holePunchAttempts: 5,
  enableSignaling: false,
  signalingServerUrl: 'wss://signaling.lanshare.dev',
  signalingApiKey: '',
};

export const useAppStore = create<AppState & AppActions>((set) => ({
  devices: [],
  transfers: [],
  settings: defaultSettings,
  isScanning: false,
  selectedDevice: null,

  setDevices: (devices) => set({ devices }),
  addDevice: (device) =>
    set((state) => {
      const exists = state.devices.some((d) => d.id === device.id);
      if (exists) {
        return {
          devices: state.devices.map((d) =>
            d.id === device.id ? { ...d, ...device, lastSeen: Date.now() } : d
          ),
        };
      }
      return { devices: [...state.devices, { ...device, lastSeen: Date.now() }] };
    }),
  removeDevice: (deviceId) =>
    set((state) => ({
      devices: state.devices.filter((d) => d.id !== deviceId),
    })),
  updateDeviceStatus: (deviceId, status) =>
    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === deviceId ? { ...d, status, lastSeen: Date.now() } : d
      ),
    })),
  setIsScanning: (scanning) => set({ isScanning: scanning }),
  setSelectedDevice: (device) => set({ selectedDevice: device }),

  addTransfer: (transfer) =>
    set((state) => ({
      transfers: [...state.transfers, transfer],
    })),
  updateTransfer: (transferId, updates) =>
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === transferId ? { ...t, ...updates } : t
      ),
    })),
  removeTransfer: (transferId) =>
    set((state) => ({
      transfers: state.transfers.filter((t) => t.id !== transferId),
    })),

  setSettings: (settings) => set({ settings }),
  updateSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),
}));
