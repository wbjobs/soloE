import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings } from '../types';
import { useAppStore } from '../store';

export function useSettings() {
  const { settings, setSettings } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loadedSettings = await invoke<AppSettings>('load_settings');
      setSettings(loadedSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, [setSettings]);

  const save = useCallback(async (newSettings: AppSettings) => {
    setIsLoading(true);
    setError(null);
    try {
      await invoke('save_settings', { settings: newSettings });
      setSettings(newSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [setSettings]);

  const update = useCallback(async (updates: Partial<AppSettings>) => {
    const newSettings = { ...settings, ...updates };
    await save(newSettings);
  }, [settings, save]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    settings,
    isLoading,
    error,
    load,
    save,
    update,
  };
}
