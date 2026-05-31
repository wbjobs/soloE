import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DeviceInfo } from '../types';
import { useAppStore } from '../store';

interface ManualConnectResult {
  success: boolean;
  device?: DeviceInfo;
  error?: string;
}

interface HolePunchResult {
  success: boolean;
  device?: DeviceInfo;
  attempts: number;
  error?: string;
}

export function useDeviceDiscovery() {
  const { devices, setDevices, addDevice, removeDevice } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [holePunchAttempt, setHolePunchAttempt] = useState<{ status: string; attempts: number; targetIp?: string; targetPort?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const discoveredDevices = await invoke<DeviceInfo[]>('discover_devices');
      setDevices(discoveredDevices);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to discover devices');
    } finally {
      setIsLoading(false);
    }
  }, [setDevices]);

  const manualConnect = useCallback(async (ip: string, port: number): Promise<ManualConnectResult> => {
    setIsConnecting(true);
    setError(null);
    try {
      const device = await invoke<DeviceInfo>('manual_connect', { ip, port });
      addDevice(device);
      return { success: true, device };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to connect';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsConnecting(false);
    }
  }, [addDevice]);

  const tryTcpHolePunch = useCallback(async (targetIp: string, targetPort: number): Promise<HolePunchResult> => {
    setHolePunchAttempt({ status: 'trying', attempts: 0, targetIp, targetPort });
    
    try {
      const result = await invoke<HolePunchResult>('try_tcp_hole_punch', { targetIp, targetPort });
      
      setHolePunchAttempt({
        status: result.success ? 'success' : 'failed',
        attempts: result.attempts,
        targetIp,
        targetPort,
      });
      
      if (result.success && result.device) {
        addDevice(result.device);
      }

      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'TCP hole punching failed';
      setHolePunchAttempt({ status: 'failed', attempts: 0, targetIp, targetPort });
      setError(errorMsg);
      return { success: false, attempts: 0, error: errorMsg };
    }
  }, [addDevice]);

  const connectViaSignaling = useCallback(async (deviceId: string): Promise<ManualConnectResult> => {
    setIsConnecting(true);
    setError(null);
    try {
      const device = await invoke<DeviceInfo>('connect_via_signaling', { deviceId });
      addDevice(device);
      return { success: true, device };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to connect via signaling server';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsConnecting(false);
    }
  }, [addDevice]);

  const getOnlineDevicesViaSignaling = useCallback(async (): Promise<DeviceInfo[]> => {
    try {
      return await invoke<DeviceInfo[]>('get_signaling_devices');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get devices from signaling server');
      return [];
    }
  }, []);

  useEffect(() => {
    refresh();

    const unlistenPromise = Promise.all([
      listen('device://discovered', (event) => {
        const device = event.payload as DeviceInfo;
        addDevice(device);
      }),
      listen('device://offline', (event) => {
        const { device_id } = event.payload as { device_id: string };
        removeDevice(device_id);
      }),
    ]);

    const interval = setInterval(refresh, 5000);

    return () => {
      clearInterval(interval);
      unlistenPromise.then((unlistens) => {
        unlistens.forEach((unlisten) => unlisten());
      });
    };
  }, [refresh, addDevice, removeDevice]);

  return {
    devices,
    isLoading,
    isConnecting,
    holePunchAttempt,
    error,
    refresh,
    manualConnect,
    tryTcpHolePunch,
    connectViaSignaling,
    getOnlineDevicesViaSignaling,
  };
}
