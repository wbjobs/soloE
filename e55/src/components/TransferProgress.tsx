import { Pause, Play, X, CheckCircle, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';
import type { TransferTask } from '../types';
import { formatBytes, formatSpeed, calculateETA, getFileIcon } from '../utils/format';

interface TransferProgressProps {
  task: TransferTask;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
}

export function TransferProgress({ task, onPause, onResume, onCancel }: TransferProgressProps) {
  const progress = task.totalSize > 0 
    ? (task.transferredSize / task.totalSize) * 100 
    : 0;

  const isSend = task.direction === 'send';
  const statusConfig = {
    pending: { icon: ArrowUp, color: 'text-warning', bg: 'bg-warning/10', text: '等待中' },
    transferring: { icon: isSend ? ArrowUp : ArrowDown, color: 'text-primary', bg: 'bg-primary/10', text: '传输中' },
    paused: { icon: Pause, color: 'text-dark-300', bg: 'bg-dark-500', text: '已暂停' },
    completed: { icon: CheckCircle, color: 'text-secondary', bg: 'bg-secondary/10', text: '已完成' },
    failed: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10', text: '失败' },
    cancelled: { icon: X, color: 'text-dark-300', bg: 'bg-dark-500', text: '已取消' },
  };

  const status = statusConfig[task.status];

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-xl ${status.bg} flex items-center justify-center`}>
            <status.icon className={`w-6 h-6 ${status.color}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-white">{task.peerDevice.name}</h4>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${status.bg} ${status.color}`}>
                {status.text}
              </span>
            </div>
            <p className="text-sm text-dark-300">
              {task.files.length} 个文件 · {formatBytes(task.totalSize)}
            </p>
          </div>
        </div>

        {task.status === 'transferring' && (
          <div className="flex gap-2">
            <button
              onClick={onPause}
              className="p-2 rounded-lg bg-dark-600 hover:bg-dark-500 text-white transition-colors"
            >
              <Pause className="w-4 h-4" />
            </button>
            <button
              onClick={onCancel}
              className="p-2 rounded-lg bg-dark-600 hover:bg-red-500/20 hover:text-red-400 text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {task.status === 'paused' && (
          <div className="flex gap-2">
            <button
              onClick={onResume}
              className="p-2 rounded-lg bg-dark-600 hover:bg-dark-500 text-white transition-colors"
            >
              <Play className="w-4 h-4" />
            </button>
            <button
              onClick={onCancel}
              className="p-2 rounded-lg bg-dark-600 hover:bg-red-500/20 hover:text-red-400 text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className="mb-4">
        <div className="progress-bar mb-2">
          <div
            className="progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-dark-300">
            {formatBytes(task.transferredSize)} / {formatBytes(task.totalSize)}
          </span>
          <span className="text-dark-300">{progress.toFixed(1)}%</span>
        </div>
      </div>

      {task.status === 'transferring' && (
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-dark-400">速度:</span>
            <span className="text-white font-mono">{formatSpeed(task.speed)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-dark-400">剩余:</span>
            <span className="text-white font-mono">
              {calculateETA(task.transferredSize, task.totalSize, task.speed)}
            </span>
          </div>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-dark-600">
        <div className="flex flex-wrap gap-2">
          {task.files.slice(0, 3).map((file) => (
            <div key={file.id} className="flex items-center gap-2 px-3 py-1.5 bg-dark-600 rounded-lg">
              <span className="text-lg">{getFileIcon(file.name)}</span>
              <span className="text-sm text-white truncate max-w-[120px]">{file.name}</span>
            </div>
          ))}
          {task.files.length > 3 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-dark-600 rounded-lg">
              <span className="text-sm text-dark-300">+{task.files.length - 3} 更多</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
