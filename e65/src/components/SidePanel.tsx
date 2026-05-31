import { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  Settings,
  Scissors,
  Info,
  ChevronDown,
  Eye,
  EyeOff,
  Tag,
  Download,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { RansacClassifier } from '../lib/RansacClassifier';
import {
  WebSocketClient,
  generateUser,
  WebSocketStatus,
} from '../lib/WebSocketClient';
import { PointClassType } from '../../shared/types';

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const Section = ({
  title,
  icon,
  children,
  defaultOpen = true,
}: SectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-slate-700">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-4 py-3 text-slate-300 hover:bg-slate-800 transition-colors"
      >
        {icon}
        <span className="font-medium">{title}</span>
        <div className="flex-1" />
        {isOpen ? <ChevronDown size={16} /> : <ChevronDown size={16} className="rotate-90" />}
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
};

export const SidePanel = () => {
  const {
    clipRegions,
    removeClipRegion,
    undoClip,
    redoClip,
    canUndo,
    canRedo,
    pointCloud,
    settings,
    updateSettings,
    annotations,
    classifications,
    addClassification,
    removeClassification,
    clearClassifications,
    exportAnnotations,
    users,
    currentUser,
    setCurrentUser,
    addUser,
    removeUser,
    applyRemoteAction,
    setLoading,
    setProgress,
  } = useStore();

  const [wsStatus, setWsStatus] = useState<WebSocketStatus>('disconnected');
  const [wsClient, setWsClient] = useState<WebSocketClient | null>(null);
  const [roomId, setRoomId] = useState('point-cloud-room');
  const [userName, setUserName] = useState('');
  const [showClassificationSettings, setShowClassificationSettings] =
    useState(false);
  const [classificationParams, setClassificationParams] = useState({
    distanceThreshold: 0.3,
    maxIterations: 1000,
  });

  useEffect(() => {
    if (!currentUser) {
      const user = generateUser();
      setCurrentUser(user);
      setUserName(user.name);
    }
  }, [currentUser, setCurrentUser]);

  const connectWebSocket = useCallback(async () => {
    if (!currentUser) return;

    const client = new WebSocketClient({
      url: `ws://localhost:3001/ws`,
      roomId,
      userId: currentUser.id,
      userName: currentUser.name,
    });

    client.setHandlers({
      onConnect: () => setWsStatus('connected'),
      onDisconnect: () => setWsStatus('disconnected'),
      onError: () => setWsStatus('error'),
      onStatusChange: (status) => setWsStatus(status),
      onAction: (action) => {
        applyRemoteAction(action);
      },
      onUserJoined: (user) => {
        addUser(user);
      },
      onUserLeft: (userId) => {
        removeUser(userId);
      },
      onUserList: (userList) => {
        userList.forEach((user) => addUser(user));
      },
    });

    try {
      await client.connect();
      setWsClient(client);
    } catch (error) {
      console.error('Failed to connect to WebSocket:', error);
    }
  }, [roomId, currentUser, addUser, removeUser, applyRemoteAction]);

  const disconnectWebSocket = useCallback(() => {
    if (wsClient) {
      wsClient.disconnect();
      setWsClient(null);
      setWsStatus('disconnected');
    }
  }, [wsClient]);

  const runClassification = useCallback(async () => {
    setLoading(true);
    setProgress(0);

    try {
      const mockPositions = new Float32Array(10000 * 3);
      for (let i = 0; i < 10000; i++) {
        mockPositions[i * 3] = (Math.random() - 0.5) * 100;
        mockPositions[i * 3 + 1] = Math.random() * 50;
        mockPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;
      }

      const classifier = new RansacClassifier(
        mockPositions,
        classificationParams
      );

      classifier.setProgressCallback((progress) => {
        setProgress(Math.floor(progress * 100));
      });

      const result = classifier.classify();

      const classTypes: PointClassType[] = ['ground', 'building', 'vegetation'];
      const pointArrays = [result.ground, result.buildings, result.vegetation];

      classTypes.forEach((type, index) => {
        if (pointArrays[index].length > 0) {
          addClassification({
            name: RansacClassifier.getClassName(type),
            type,
            pointIndices: pointArrays[index],
            color: RansacClassifier.getClassColor(type),
          });
        }
      });
    } catch (error) {
      console.error('Classification error:', error);
    } finally {
      setLoading(false);
    }
  }, [classificationParams, addClassification, setLoading, setProgress]);

  const handleExport = useCallback(() => {
    const data = exportAnnotations();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `point-cloud-annotations-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportAnnotations]);

  return (
    <div className="w-80 bg-slate-900 border-r border-slate-700 overflow-y-auto flex flex-col">
      <Section title="协同编辑" icon={<Users size={16} />} defaultOpen={false}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-400 mb-1">房间ID</label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              disabled={wsStatus === 'connected'}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200 text-sm focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">用户名</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              disabled={wsStatus === 'connected'}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200 text-sm focus:outline-none focus:border-cyan-500"
            />
          </div>
          {wsStatus !== 'connected' ? (
            <button
              onClick={connectWebSocket}
              disabled={!roomId || !userName}
              className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded text-sm font-medium transition-colors"
            >
              连接房间
            </button>
          ) : (
            <button
              onClick={disconnectWebSocket}
              className="w-full py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm font-medium transition-colors"
            >
              断开连接
            </button>
          )}
          <div className="flex items-center gap-2 text-sm">
            <div
              className={`w-2 h-2 rounded-full ${
                wsStatus === 'connected'
                  ? 'bg-emerald-500'
                  : wsStatus === 'connecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-slate-500'
              }`}
            />
            <span className="text-slate-400">
              {wsStatus === 'connected'
                ? '已连接'
                : wsStatus === 'connecting'
                ? '连接中...'
                : '未连接'}
            </span>
          </div>
          {users.length > 0 && (
            <div className="mt-2">
              <div className="text-sm text-slate-400 mb-2">在线用户:</div>
              <div className="space-y-1">
                {users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-2 px-2 py-1 bg-slate-800 rounded"
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: user.color }}
                    />
                    <span className="text-sm text-slate-300">{user.name}</span>
                    {user.isOnline && (
                      <div className="w-2 h-2 bg-emerald-500 rounded-full ml-auto" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section title="点云分类" icon={<Tag size={16} />}>
        <div className="space-y-3">
          <button
            onClick={() => setShowClassificationSettings(!showClassificationSettings)}
            className="text-sm text-cyan-400 hover:text-cyan-300"
          >
            {showClassificationSettings ? '隐藏设置' : '显示设置'}
          </button>

          {showClassificationSettings && (
            <div className="space-y-3 p-3 bg-slate-800 rounded">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  距离阈值: {classificationParams.distanceThreshold}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="2"
                  step="0.1"
                  value={classificationParams.distanceThreshold}
                  onChange={(e) =>
                    setClassificationParams((p) => ({
                      ...p,
                      distanceThreshold: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  最大迭代: {classificationParams.maxIterations}
                </label>
                <input
                  type="range"
                  min="100"
                  max="5000"
                  step="100"
                  value={classificationParams.maxIterations}
                  onChange={(e) =>
                    setClassificationParams((p) => ({
                      ...p,
                      maxIterations: parseInt(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-500"
                />
              </div>
            </div>
          )}

          <button
            onClick={runClassification}
            className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm font-medium transition-colors"
          >
            <Zap size={14} className="inline mr-1" />
            运行RANSAC分类
          </button>

          {classifications.length > 0 && (
            <div className="space-y-2 mt-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-400">
                  分类结果 ({classifications.length})
                </span>
                <button
                  onClick={clearClassifications}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  清空
                </button>
              </div>
              {classifications.map((cls) => (
                <div
                  key={cls.id}
                  className="flex items-center gap-2 p-2 bg-slate-800 rounded"
                >
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: cls.color }}
                  />
                  <span className="text-sm text-slate-300 flex-1">
                    {cls.name}
                  </span>
                  <span className="text-xs text-slate-500">
                    {cls.pointIndices.length} 点
                  </span>
                  <button
                    onClick={() => removeClassification(cls.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="标注数据" icon={<Download size={16} />} defaultOpen={false}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="p-2 bg-slate-800 rounded text-center">
              <div className="text-slate-500">标注点</div>
              <div className="text-cyan-400 font-medium">{annotations.length}</div>
            </div>
            <div className="p-2 bg-slate-800 rounded text-center">
              <div className="text-slate-500">分类数</div>
              <div className="text-cyan-400 font-medium">{classifications.length}</div>
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={annotations.length === 0 && classifications.length === 0}
            className="w-full flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded text-sm font-medium transition-colors"
          >
            <Download size={14} />
            导出JSON
          </button>
        </div>
      </Section>

      <Section title="裁剪区域" icon={<Scissors size={16} />}>
        <div className="flex gap-2 mb-3">
          <button
            onClick={undoClip}
            disabled={!canUndo()}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-sm transition-colors ${
              canUndo()
                ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            ↩ 撤销
          </button>
          <button
            onClick={redoClip}
            disabled={!canRedo()}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-sm transition-colors ${
              canRedo()
                ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            ↪ 重做
          </button>
        </div>

        {clipRegions.length > 0 ? (
          <div className="space-y-2">
            {clipRegions.map((region) => (
              <div
                key={region.id}
                className="flex items-center gap-2 p-2 bg-slate-800 rounded"
              >
                <button
                  onClick={() =>
                    updateSettings({
                      ...settings,
                    })
                  }
                  className="text-slate-400 hover:text-slate-200"
                >
                  {region.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <span className="text-sm text-slate-300 flex-1">
                  {region.type === 'rectangle' && '矩形'}
                  {region.type === 'sphere' && '球形'}
                  {region.type === 'polygon' && '多边形'}
                  {region.inverse ? ' (反向)' : ''}
                </span>
                <button
                  onClick={() => removeClipRegion(region.id)}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500 text-center py-4">
            选择裁剪工具后在视口中绘制
          </div>
        )}
      </Section>

      <Section title="渲染设置" icon={<Settings size={16} />}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">着色模式</label>
            <div className="grid grid-cols-2 gap-2">
              {(['elevation', 'rgb', 'classification'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => updateSettings({ colorMode: mode as any })}
                  className={`px-3 py-2 rounded text-sm transition-colors ${
                    settings.colorMode === mode
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {mode === 'elevation' && '高程'}
                  {mode === 'rgb' && 'RGB'}
                  {mode === 'classification' && '分类'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">
              点大小: {settings.pointSize.toFixed(1)}
            </label>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.1"
              value={settings.pointSize}
              onChange={(e) => updateSettings({ pointSize: parseFloat(e.target.value) })}
              className="w-full accent-cyan-500"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">
              LOD 偏差: {settings.lodBias.toFixed(1)}
            </label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={settings.lodBias}
              onChange={(e) => updateSettings({ lodBias: parseFloat(e.target.value) })}
              className="w-full accent-cyan-500"
            />
          </div>
        </div>
      </Section>

      <Section title="点云信息" icon={<Info size={16} />} defaultOpen={false}>
        {pointCloud ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">文件名:</span>
              <span className="text-slate-200 truncate max-w-32">{pointCloud.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">格式:</span>
              <span className="text-slate-200">{pointCloud.format.toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">总点数:</span>
              <span className="text-cyan-400">{pointCloud.totalPoints.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">RGB:</span>
              <span className={pointCloud.hasRGB ? 'text-emerald-400' : 'text-slate-500'}>
                {pointCloud.hasRGB ? '是' : '否'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">强度:</span>
              <span className={pointCloud.hasIntensity ? 'text-emerald-400' : 'text-slate-500'}>
                {pointCloud.hasIntensity ? '是' : '否'}
              </span>
            </div>
            <div className="mt-3 p-2 bg-slate-800 rounded">
              <div className="text-slate-400 text-xs mb-1">边界范围:</div>
              <div className="text-xs text-slate-300 font-mono">
                <div>X: {pointCloud.bounds.min[0].toFixed(2)} → {pointCloud.bounds.max[0].toFixed(2)}</div>
                <div>Y: {pointCloud.bounds.min[1].toFixed(2)} → {pointCloud.bounds.max[1].toFixed(2)}</div>
                <div>Z: {pointCloud.bounds.min[2].toFixed(2)} → {pointCloud.bounds.max[2].toFixed(2)}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500 text-center py-4">
            请加载 LAS 或 PLY 格式点云文件
          </div>
        )}
      </Section>
    </div>
  );
};
