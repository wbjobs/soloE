import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { TransferTask, FileItem } from '../types';
import { useAppStore } from '../store';

interface TransferEventPayload {
  transfer_id: string;
  bytes_transferred?: number;
  total_bytes?: number;
  speed?: number;
  error?: string;
}

export function useTransfer() {
  const { transfers, addTransfer, updateTransfer, removeTransfer } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const currentTransfers = await invoke<TransferTask[]>('get_transfers');
      currentTransfers.forEach((t) => addTransfer(t));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get transfers');
    } finally {
      setIsLoading(false);
    }
  }, [addTransfer]);

  const startTransfer = useCallback(async (targetDeviceId: string, files: FileItem[]) => {
    setIsLoading(true);
    setError(null);
    try {
      const transferId = await invoke<string>('start_transfer', {
        targetDeviceId,
        files,
      });
      await refresh();
      return transferId;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start transfer');
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [refresh]);

  const pauseTransfer = useCallback(async (transferId: string) => {
    try {
      await invoke('pause_transfer', { transferId });
      updateTransfer(transferId, {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pause transfer');
    }
  }, [updateTransfer]);

  const resumeTransfer = useCallback(async (transferId: string) => {
    try {
      await invoke('resume_transfer', { transferId });
      updateTransfer(transferId, {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume transfer');
    }
  }, [updateTransfer]);

  const cancelTransfer = useCallback(async (transferId: string) => {
    try {
      await invoke('cancel_transfer', { transferId });
      removeTransfer(transferId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel transfer');
    }
  }, [removeTransfer]);

  useEffect(() => {
    refresh();

    const unlistenPromise = Promise.all([
      listen('transfer://progress', (event) => {
        const payload = event.payload as TransferEventPayload;
        updateTransfer(payload.transfer_id, {
          transferredSize: payload.bytes_transferred || 0,
        });
      }),
      listen('transfer://speed', (event) => {
        const payload = event.payload as TransferEventPayload;
        updateTransfer(payload.transfer_id, {
          speed: payload.speed || 0,
        });
      }),
      listen('transfer://completed', (event) => {
        const payload = event.payload as TransferEventPayload;
        updateTransfer(payload.transfer_id, {
          status: 'completed',
          endTime: Date.now(),
        });
      }),
      listen('transfer://failed', (event) => {
        const payload = event.payload as TransferEventPayload;
        updateTransfer(payload.transfer_id, {
          status: 'failed',
          error: payload.error,
          endTime: Date.now(),
        });
      }),
    ]);

    return () => {
      unlistenPromise.then((unlistens) => {
        unlistens.forEach((unlisten) => unlisten());
      });
    };
  }, [refresh, updateTransfer]);

  return {
    transfers,
    isLoading,
    error,
    refresh,
    startTransfer,
    pauseTransfer,
    resumeTransfer,
    cancelTransfer,
  };
}
