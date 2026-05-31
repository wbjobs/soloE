import React from 'react';
import { MigrationProgress } from '../types';
import { Clock, Database, AlertTriangle, CheckCircle, Loader, AlertCircle } from 'lucide-react';

interface TableCardProps {
  progress: MigrationProgress;
}

const statusConfig: Record<string, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
  pending: { color: 'text-gray-500', bgColor: 'bg-gray-100', icon: <Clock size={16} />, label: '等待中' },
  migrating: { color: 'text-blue-600', bgColor: 'bg-blue-100', icon: <Loader size={16} className="animate-spin" />, label: '迁移中' },
  migrated: { color: 'text-purple-600', bgColor: 'bg-purple-100', icon: <Database size={16} />, label: '已迁移' },
  validating: { color: 'text-yellow-600', bgColor: 'bg-yellow-100', icon: <Loader size={16} className="animate-spin" />, label: '校验中' },
  completed: { color: 'text-green-600', bgColor: 'bg-green-100', icon: <CheckCircle size={16} />, label: '已完成' },
  failed: { color: 'text-red-600', bgColor: 'bg-red-100', icon: <AlertCircle size={16} />, label: '失败' }
};

export const TableCard: React.FC<TableCardProps> = ({ progress }) => {
  const config = statusConfig[progress.status] || statusConfig.pending;
  const percent = progress.totalRows > 0 ? (progress.migratedRows / progress.totalRows) * 100 : 0;

  const formatTime = (ms: number): string => {
    if (ms === Infinity || ms < 0 || !isFinite(ms)) return '--:--:--';
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-5 border border-gray-200 hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800 truncate flex-1 mr-2">
          {progress.tableName}
        </h3>
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}>
          {config.icon}
          {config.label}
        </span>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>迁移进度</span>
          <span>{progress.migratedRows.toLocaleString()} / {progress.totalRows.toLocaleString()}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-300 ${
              progress.status === 'failed' ? 'bg-red-500' :
              progress.status === 'completed' ? 'bg-green-500' :
              progress.status === 'validating' ? 'bg-yellow-500' :
              'bg-blue-500'
            }`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
        <div className="text-right text-sm text-gray-500 mt-1">
          {percent.toFixed(2)}%
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500" />
          <span className="text-gray-600">失败:</span>
          <span className="font-medium text-red-600">{progress.failedRows}</span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle size={16} className="text-green-500" />
          <span className="text-gray-600">校验:</span>
          <span className="font-medium text-green-600">
            {progress.validatedRows.toLocaleString()}
            {progress.validationFailedRows > 0 && (
              <span className="text-red-500 ml-1">(-{progress.validationFailedRows})</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-blue-500" />
          <span className="text-gray-600">速度:</span>
          <span className="font-medium">{progress.rowsPerSecond.toFixed(1)} 行/秒</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-purple-500" />
          <span className="text-gray-600">预计:</span>
          <span className="font-medium">{formatTime(progress.estimatedRemainingTime)}</span>
        </div>
      </div>
    </div>
  );
};
