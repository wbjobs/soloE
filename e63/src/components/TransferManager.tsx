import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileInfo, TransferSession } from '../types';

interface TransferManagerProps {
  transfers: Map<string, TransferSession>;
  selectedFile: FileInfo | null;
  selectedDevices: string[];
  onStartTransfer: () => void;
  onUpdateProgress: (sessionId: string, chunkIndex: number, bytes: number) => void;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatSpeed = (bytesPerSecond: number): string => {
  if (bytesPerSecond < 1024) return bytesPerSecond.toFixed(2) + ' B/s';
  if (bytesPerSecond < 1024 * 1024) return (bytesPerSecond / 1024).toFixed(2) + ' KB/s';
  return (bytesPerSecond / (1024 * 1024)).toFixed(2) + ' MB/s';
};

const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function TransferManager({
  transfers,
  selectedFile,
  selectedDevices,
  onStartTransfer,
  onUpdateProgress,
}: TransferManagerProps) {
  const transferWorkersRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    transfers.forEach((session, sessionId) => {
      if (session.status === 'transferring' && !transferWorkersRef.current.has(sessionId)) {
        startTransferWorker(session);
      }
    });

    return () => {
      transferWorkersRef.current.forEach((worker) => {
        if (worker) worker.cancel = true;
      });
    };
  }, [transfers]);

  const startTransferWorker = async (session: TransferSession) => {
    const worker = { cancel: false };
    transferWorkersRef.current.set(session.sessionId, worker);

    try {
      for (let i = 0; i < session.totalChunks; i++) {
        if (worker.cancel) break;

        const chunk = await invoke('read_chunk', {
          fileId: session.fileId,
          chunkIndex: i,
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        const bytesTransferred = (i + 1) * 1024 * 1024;
        onUpdateProgress(session.sessionId, i, Math.min(bytesTransferred, session.totalChunks * 1024 * 1024));
      }
    } catch (error) {
      console.error('Transfer error:', error);
    } finally {
      transferWorkersRef.current.delete(session.sessionId);
    }
  };

  const getEstimatedTime = (session: TransferSession): number => {
    if (session.speed <= 0) return 0;
    const remainingBytes = session.totalChunks * 1024 * 1024 - session.bytesTransferred;
    return remainingBytes / session.speed;
  };

  const canStartTransfer = selectedFile && selectedDevices.length > 0;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h2 className="card-title">传输任务</h2>

      <div className="transfer-list">
        {transfers.size === 0 ? (
          <div className="no-transfers">
            <p>暂无传输任务</p>
            <p style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
              选择文件和目标设备后，点击开始传输
            </p>
          </div>
        ) : (
          Array.from(transfers.values()).map((session) => {
            const progress = (session.transferredChunks / session.totalChunks) * 100;
            const estimatedTime = getEstimatedTime(session);

            return (
              <div key={session.sessionId} className="transfer-item">
                <div className="transfer-header">
                  <span className="transfer-file-name">{session.fileName}</span>
                  <span className={`transfer-status ${session.status}`}>
                    {session.status === 'completed' ? '已完成' : '传输中'}
                  </span>
                </div>
                <div className="transfer-peer">
                  发送到: {session.peerName}
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="transfer-stats">
                  <span>
                    {formatSize(session.bytesTransferred)} / {formatSize(session.totalChunks * 1024 * 1024)}
                  </span>
                  <span>{formatSpeed(session.speed)}</span>
                  <span>剩余: {formatTime(estimatedTime)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="start-transfer-section">
        <button
          className="btn btn-primary start-transfer-btn"
          disabled={!canStartTransfer}
          onClick={onStartTransfer}
        >
          {!selectedFile
            ? '请先选择文件'
            : selectedDevices.length === 0
            ? '请选择目标设备'
            : `开始传输 (${selectedDevices.length} 个设备)`}
        </button>
      </div>
    </div>
  );
}
