import React from 'react';
import { MigrationStats } from '../types';
import { Database, CheckCircle, AlertTriangle, Clock, Activity } from 'lucide-react';

interface StatsOverviewProps {
  stats: MigrationStats;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({ stats }) => {
  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const overallPercent = stats.totalRows > 0 ? (stats.totalMigratedRows / stats.totalRows) * 100 : 0;

  return (
    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl shadow-lg p-6 text-white mb-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Database size={28} />
          数据迁移监控面板
        </h1>
        <div className="flex items-center gap-2 bg-white/20 px-3 py-1 rounded-full">
          <Clock size={18} />
          <span className="font-mono">{formatTime(stats.elapsedTime)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white/10 rounded-lg p-4 backdrop-blur">
          <div className="flex items-center gap-2 mb-1">
            <Activity size={20} />
            <span className="text-sm opacity-80">总进度</span>
          </div>
          <div className="text-2xl font-bold">{overallPercent.toFixed(1)}%</div>
          <div className="text-xs opacity-60">
            {stats.completedTables} / {stats.totalTables} 表
          </div>
        </div>

        <div className="bg-white/10 rounded-lg p-4 backdrop-blur">
          <div className="flex items-center gap-2 mb-1">
            <Database size={20} />
            <span className="text-sm opacity-80">已迁移</span>
          </div>
          <div className="text-2xl font-bold">{stats.totalMigratedRows.toLocaleString()}</div>
          <div className="text-xs opacity-60">共 {stats.totalRows.toLocaleString()} 行</div>
        </div>

        <div className="bg-white/10 rounded-lg p-4 backdrop-blur">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={20} />
            <span className="text-sm opacity-80">已校验</span>
          </div>
          <div className="text-2xl font-bold">{stats.totalValidatedRows.toLocaleString()}</div>
          <div className="text-xs opacity-60">数据完整性校验</div>
        </div>

        <div className="bg-white/10 rounded-lg p-4 backdrop-blur">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={20} />
            <span className="text-sm opacity-80">失败</span>
          </div>
          <div className="text-2xl font-bold">
            {stats.totalFailedRows + stats.totalValidationFailedRows}
          </div>
          <div className="text-xs opacity-60">
            迁移 {stats.totalFailedRows} / 校验 {stats.totalValidationFailedRows}
          </div>
        </div>
      </div>

      <div className="w-full bg-white/20 rounded-full h-3">
        <div
          className="h-3 rounded-full bg-white transition-all duration-300"
          style={{ width: `${Math.min(overallPercent, 100)}%` }}
        />
      </div>
    </div>
  );
};
