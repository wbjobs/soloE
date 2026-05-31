import { useStore } from '../store/useStore';
import { Database, Activity, HardDrive, Layers } from 'lucide-react';

export const StatusBar = () => {
  const { stats, pointCloud, isLoading, progress } = useStore();

  return (
    <div className="h-8 bg-slate-900 border-t border-slate-700 flex items-center px-4 gap-6 text-sm">
      <div className="flex items-center gap-2 text-slate-400">
        <Database size={14} />
        <span>点云数据:</span>
        <span className="text-cyan-400 font-medium">
          {pointCloud ? pointCloud.name : '演示数据'}
        </span>
      </div>

      <div className="h-4 w-px bg-slate-700" />

      <div className="flex items-center gap-2 text-slate-400">
        <Layers size={14} />
        <span>可见点:</span>
        <span className="text-emerald-400 font-medium">
          {stats.visiblePoints.toLocaleString()}
        </span>
      </div>

      <div className="h-4 w-px bg-slate-700" />

      <div className="flex items-center gap-2 text-slate-400">
        <Activity size={14} />
        <span>FPS:</span>
        <span
          className={`font-medium ${
            stats.fps >= 50
              ? 'text-emerald-400'
              : stats.fps >= 30
              ? 'text-yellow-400'
              : 'text-red-400'
          }`}
        >
          {stats.fps}
        </span>
      </div>

      <div className="h-4 w-px bg-slate-700" />

      <div className="flex items-center gap-2 text-slate-400">
        <HardDrive size={14} />
        <span>显存:</span>
        <span className="text-amber-400 font-medium">{stats.memoryUsage} MB</span>
      </div>

      {isLoading && (
        <>
          <div className="h-4 w-px bg-slate-700" />
          <div className="flex items-center gap-3">
            <div className="w-32 h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-cyan-400">{progress}%</span>
          </div>
        </>
      )}

      <div className="flex-1" />

      <div className="text-slate-500">
        {pointCloud ? (
          <span>
            总计 {pointCloud.totalPoints.toLocaleString()} 点 ·{' '}
            {pointCloud.format.toUpperCase()} 格式
          </span>
        ) : (
          <span>支持 LAS / PLY 格式点云文件</span>
        )}
      </div>
    </div>
  );
};
