import { SearchState, AlgorithmType } from '../types';

interface ControlPanelProps {
  isRunning: boolean;
  searchState: SearchState;
  speed: number;
  algorithm: AlgorithmType;
  startNode: string;
  targetNode: string;
  nodeOptions: string[];
  onSpeedChange: (speed: number) => void;
  onAlgorithmChange: (algorithm: AlgorithmType) => void;
  onStartNodeChange: (node: string) => void;
  onTargetNodeChange: (node: string) => void;
  onStart: () => void;
  onReset: () => void;
  totalNodes: number;
}

export const ControlPanel = ({
  isRunning,
  searchState,
  speed,
  algorithm,
  startNode,
  targetNode,
  nodeOptions,
  onSpeedChange,
  onAlgorithmChange,
  onStartNodeChange,
  onTargetNodeChange,
  onStart,
  onReset,
  totalNodes,
}: ControlPanelProps) => {
  return (
    <div className="controls-bg rounded-2xl p-6 space-y-5 max-h-screen overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">
          图搜索算法可视化
        </h1>
        <p className="text-slate-400 text-sm">
          BFS / A* 算法执行过程可视化
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-slate-300 text-sm font-medium">算法选择</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onAlgorithmChange('BFS')}
            disabled={isRunning}
            className={`py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
              algorithm === 'BFS'
                ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            BFS
          </button>
          <button
            onClick={() => onAlgorithmChange('ASTAR')}
            disabled={isRunning}
            className={`py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
              algorithm === 'ASTAR'
                ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/30'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            A*
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-slate-300 text-sm font-medium">起点</label>
          <select
            value={startNode}
            onChange={(e) => onStartNodeChange(e.target.value)}
            disabled={isRunning}
            className="w-full bg-slate-700 text-white py-2 px-3 rounded-lg text-sm border border-slate-600 focus:border-blue-500 focus:outline-none"
          >
            {nodeOptions.map((node) => (
              <option key={node} value={node}>{node}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-slate-300 text-sm font-medium">终点</label>
          <select
            value={targetNode}
            onChange={(e) => onTargetNodeChange(e.target.value)}
            disabled={isRunning}
            className="w-full bg-slate-700 text-white py-2 px-3 rounded-lg text-sm border border-slate-600 focus:border-blue-500 focus:outline-none"
          >
            {nodeOptions.map((node) => (
              <option key={node} value={node}>{node}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-slate-300 text-sm">动画速度</span>
          <span className="text-blue-400 font-semibold text-sm">{speed}ms</span>
        </div>
        <input
          type="range"
          min="100"
          max="2000"
          step="100"
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          disabled={isRunning}
          className="slider w-full"
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={onStart}
          disabled={isRunning || searchState.isComplete || startNode === targetNode}
          className="btn-primary flex-1 py-3 px-4 rounded-xl text-white font-semibold text-sm"
        >
          {searchState.isComplete 
            ? searchState.foundTarget 
              ? '已找到路径' 
              : '未找到'
            : isRunning 
              ? '执行中...' 
              : `开始 ${algorithm === 'ASTAR' ? 'A*' : 'BFS'}`
          }
        </button>
        <button
          onClick={onReset}
          className="btn-secondary py-3 px-6 rounded-xl text-white font-semibold text-sm"
        >
          重置
        </button>
      </div>

      <div className="status-card rounded-xl p-4 space-y-4">
        <h3 className="text-white font-semibold text-sm border-b border-slate-700 pb-2">
          算法状态
        </h3>
        
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800/50 rounded-lg p-3">
            <div className="text-slate-400 text-xs mb-1">当前步骤</div>
            <div className="text-2xl font-bold text-blue-400">{searchState.step}</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3">
            <div className="text-slate-400 text-xs mb-1">已访问节点</div>
            <div className="text-2xl font-bold text-emerald-400">
              {searchState.visited.length} / {totalNodes}
            </div>
          </div>
        </div>

        {searchState.current && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <div className="text-amber-400 text-xs mb-1">当前访问节点</div>
            <div className="text-3xl font-bold text-amber-400 flex items-center gap-2">
              <span className="w-3 h-3 bg-amber-400 rounded-full animate-pulse"></span>
              {searchState.current}
            </div>
          </div>
        )}

        {searchState.isComplete && searchState.foundTarget && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
            <div className="text-emerald-400 text-sm font-semibold flex items-center gap-2 mb-2">
              <span>✓</span>
              {algorithm === 'ASTAR' ? 'A*' : 'BFS'} 搜索完成！
            </div>
            <div className="text-slate-400 text-xs mb-2">最短路径：</div>
            <div className="flex flex-wrap gap-1">
              {searchState.path.map((node, idx) => (
                <span key={node} className="inline-flex items-center">
                  <span className="bg-emerald-600 text-white px-2 py-0.5 rounded text-xs font-mono">
                    {node}
                  </span>
                  {idx < searchState.path.length - 1 && (
                    <span className="text-emerald-400 mx-0.5">→</span>
                  )}
                </span>
              ))}
            </div>
            <div className="text-slate-400 text-xs mt-2">
              路径长度：{searchState.path.length} 步
            </div>
          </div>
        )}

        {searchState.isComplete && !searchState.foundTarget && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <div className="text-red-400 text-sm font-semibold flex items-center gap-2">
              <span>✗</span>
              未找到路径：节点不可达
            </div>
          </div>
        )}

        {searchState.queue.length > 0 && !searchState.isComplete && (
          <div className="bg-slate-800/50 rounded-lg p-3">
            <div className="text-slate-400 text-xs mb-2">
              {algorithm === 'ASTAR' ? '开放集' : '待访问队列'}
            </div>
            <div className="flex flex-wrap gap-2 max-h-20 overflow-y-auto">
              {searchState.queue.slice(0, 8).map((node) => (
                <span
                  key={node}
                  className="bg-slate-700 text-slate-300 px-2 py-1 rounded text-xs font-mono"
                >
                  {node}
                </span>
              ))}
              {searchState.queue.length > 8 && (
                <span className="text-slate-500 text-xs py-1">
                  +{searchState.queue.length - 8} 更多
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-white font-semibold text-sm">图例</h3>
        <div className="grid grid-cols-1 gap-2">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-slate-500"></div>
            <span className="text-slate-400 text-sm">未访问</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-emerald-500"></div>
            <span className="text-slate-400 text-sm">已访问</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-amber-500 animate-pulse"></div>
            <span className="text-slate-400 text-sm">当前节点</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-pink-500"></div>
            <span className="text-slate-400 text-sm">路径节点</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-1 rounded bg-pink-500"></div>
            <span className="text-slate-400 text-sm">最短路径</span>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-700 pt-4">
        <p className="text-slate-500 text-xs">
          提示：拖拽节点可调整位置，滚轮可缩放画布
        </p>
      </div>
    </div>
  );
};
