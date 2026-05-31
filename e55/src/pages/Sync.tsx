import { useState, useEffect } from 'react';
import { RefreshCw, Plus, Play, Pause, Trash2, FolderOpen, ArrowLeftRight, ArrowUp, ArrowDown, File, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { DeviceInfo, SyncSessionConfig, SyncStatus, SyncMode } from '../types';
import { useDeviceDiscovery } from '../hooks/useDeviceDiscovery';
import { formatBytes, formatTime } from '../utils/format';

export function Sync() {
  const { devices } = useDeviceDiscovery();
  const [sessions, setSessions] = useState<SyncSessionConfig[]>([]);
  const [sessionStatuses, setSessionStatuses] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DeviceInfo | null>(null);
  const [localPath, setLocalPath] = useState('');
  const [syncMode, setSyncMode] = useState<SyncMode>('bidirectional');

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setIsLoading(true);
    try {
      const sessionList = await invoke<SyncSessionConfig[]>('get_sync_sessions');
      setSessions(sessionList);
      
      const statusMap = new Map<string, string>();
      for (const session of sessionList) {
        const status = await invoke<string | null>('get_sync_session_status', { sessionId: session.session_id });
        if (status) {
          statusMap.set(session.session_id, status);
        }
      }
      setSessionStatuses(statusMap);
    } catch (error) {
      console.error('Failed to load sync sessions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateSession = async () => {
    if (!selectedDevice || !localPath) return;
    
    try {
      const sessionId = await invoke<string>('create_sync_session', {
        localPath,
        peerDevice: selectedDevice,
        syncMode,
      });
      
      await invoke('start_sync_session', { sessionId });
      await loadSessions();
      setShowCreateModal(false);
      setLocalPath('');
      setSelectedDevice(null);
    } catch (error) {
      console.error('Failed to create sync session:', error);
    }
  };

  const handleStartSession = async (sessionId: string) => {
    try {
      await invoke('start_sync_session', { sessionId });
      await loadSessions();
    } catch (error) {
      console.error('Failed to start session:', error);
    }
  };

  const handleStopSession = async (sessionId: string) => {
    try {
      await invoke('stop_sync_session', { sessionId });
      await loadSessions();
    } catch (error) {
      console.error('Failed to stop session:', error);
    }
  };

  const handleRemoveSession = async (sessionId: string) => {
    try {
      await invoke('remove_sync_session', { sessionId });
      await loadSessions();
    } catch (error) {
      console.error('Failed to remove session:', error);
    }
  };

  const handleSyncNow = async (sessionId: string) => {
    try {
      await invoke('sync_session_now', { sessionId });
    } catch (error) {
      console.error('Failed to sync now:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'idle': return 'text-gray-400';
      case 'scanning': return 'text-blue-400';
      case 'syncing': return 'text-green-400';
      case 'paused': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'idle': return <Clock className="w-4 h-4" />;
      case 'scanning': return <RefreshCw className="w-4 h-4 animate-spin" />;
      case 'syncing': return <RefreshCw className="w-4 h-4 animate-spin" />;
      case 'paused': return <Pause className="w-4 h-4" />;
      case 'error': return <AlertCircle className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'bidirectional': return <ArrowLeftRight className="w-4 h-4" />;
      case 'send_only': return <ArrowUp className="w-4 h-4" />;
      case 'receive_only': return <ArrowDown className="w-4 h-4" />;
      default: return <ArrowLeftRight className="w-4 h-4" />;
    }
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'bidirectional': return '双向同步';
      case 'send_only': return '仅发送';
      case 'receive_only': return '仅接收';
      default: return mode;
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">文件夹同步</h1>
            <p className="text-dark-300">实时监控并同步设备间的文件夹变更</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={loadSessions}
              disabled={isLoading}
              className="btn btn-secondary flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              刷新
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              创建同步
            </button>
          </div>
        </div>

        {sessions.length > 0 ? (
          <div className="space-y-4">
            {sessions.map((session) => {
              const status = sessionStatuses.get(session.session_id) || 'idle';
              
              return (
                <div key={session.session_id} className="card p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
                        <FolderOpen className="w-7 h-7 text-blue-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-white">
                            {session.peer_device.name}
                          </h3>
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${getStatusColor(status)} bg-dark-600`}>
                            {getStatusIcon(status)}
                            {status === 'idle' && '空闲'}
                            {status === 'scanning' && '扫描中'}
                            {status === 'syncing' && '同步中'}
                            {status === 'paused' && '已暂停'}
                            {status === 'error' && '错误'}
                          </span>
                        </div>
                        <p className="text-sm text-dark-400 font-mono">
                          {session.local_path}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSyncNow(session.session_id)}
                        disabled={status === 'syncing' || status === 'scanning'}
                        className="p-2 rounded-lg bg-dark-600 hover:bg-dark-500 text-white disabled:opacity-50 transition-colors"
                        title="立即同步"
                      >
                        <RefreshCw className={`w-4 h-4 ${status === 'syncing' ? 'animate-spin' : ''}`} />
                      </button>
                      {status === 'idle' || status === 'paused' ? (
                        <button
                          onClick={() => handleStartSession(session.session_id)}
                          className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 transition-colors"
                          title="开始同步"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStopSession(session.session_id)}
                          className="p-2 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 transition-colors"
                          title="暂停同步"
                        >
                          <Pause className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleRemoveSession(session.session_id)}
                        className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                        title="删除同步"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-3 bg-dark-600/50 rounded-lg">
                      <div className="flex items-center gap-2 text-dark-300 text-sm mb-1">
                        {getModeIcon(session.sync_mode)}
                        <span>同步模式</span>
                      </div>
                      <div className="text-white font-medium">
                        {getModeLabel(session.sync_mode)}
                      </div>
                    </div>
                    
                    <div className="p-3 bg-dark-600/50 rounded-lg">
                      <div className="flex items-center gap-2 text-dark-300 text-sm mb-1">
                        <File className="w-4 h-4" />
                        <span>分块大小</span>
                      </div>
                      <div className="text-white font-medium">
                        {formatBytes(session.chunk_size)}
                      </div>
                    </div>
                    
                    <div className="p-3 bg-dark-600/50 rounded-lg">
                      <div className="flex items-center gap-2 text-dark-300 text-sm mb-1">
                        <CheckCircle className="w-4 h-4" />
                        <span>自动启动</span>
                      </div>
                      <div className="text-white font-medium">
                        {session.auto_start ? '已启用' : '已禁用'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2 text-sm text-dark-400">
                    <span>设备地址:</span>
                    <code className="font-mono bg-dark-600 px-2 py-1 rounded">
                      {session.peer_device.ip}:{session.peer_device.port}
                    </code>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card p-12 text-center">
            <div className="w-20 h-20 rounded-2xl bg-dark-600 flex items-center justify-center mx-auto mb-4">
              <FolderOpen className="w-10 h-10 text-dark-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">暂无同步任务</h3>
            <p className="text-dark-300 mb-6">
              创建同步任务来实时监控并同步文件夹变更
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn btn-primary flex items-center gap-2 mx-auto"
            >
              <Plus className="w-4 h-4" />
              创建第一个同步任务
            </button>
          </div>
        )}

        {showCreateModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="card w-full max-w-xl">
              <div className="flex items-center justify-between p-6 border-b border-dark-600">
                <div>
                  <h3 className="text-lg font-semibold text-white">创建同步任务</h3>
                  <p className="text-sm text-dark-300">配置文件夹实时同步</p>
                </div>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setSelectedDevice(null);
                    setLocalPath('');
                  }}
                  className="p-2 rounded-lg hover:bg-dark-600 text-dark-300 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    选择目标设备
                  </label>
                  <select
                    value={selectedDevice?.id || ''}
                    onChange={(e) => {
                      const device = devices.find(d => d.id === e.target.value);
                      setSelectedDevice(device || null);
                    }}
                    className="w-full px-4 py-3 bg-dark-600 border border-dark-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">请选择设备...</option>
                    {devices.filter(d => d.status === 'online').map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name} ({device.ip})
                      </option>
                    ))}
                  </select>
                  {devices.filter(d => d.status === 'online').length === 0 && (
                    <p className="text-sm text-yellow-400 mt-2">
                      暂无在线设备，请确保其他设备正在运行应用
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    本地文件夹路径
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={localPath}
                      onChange={(e) => setLocalPath(e.target.value)}
                      placeholder="选择要同步的文件夹..."
                      className="flex-1 px-4 py-3 bg-dark-600 border border-dark-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button className="btn btn-secondary px-4">
                      <FolderOpen className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white mb-3">
                    同步模式
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => setSyncMode('bidirectional')}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        syncMode === 'bidirectional'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-dark-500 bg-dark-600 text-dark-300 hover:border-dark-400'
                      }`}
                    >
                      <ArrowLeftRight className="w-6 h-6 mx-auto mb-2" />
                      <div className="font-medium text-sm">双向同步</div>
                      <p className="text-xs opacity-70 mt-1">保持两端文件一致</p>
                    </button>
                    
                    <button
                      onClick={() => setSyncMode('send_only')}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        syncMode === 'send_only'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-dark-500 bg-dark-600 text-dark-300 hover:border-dark-400'
                      }`}
                    >
                      <ArrowUp className="w-6 h-6 mx-auto mb-2" />
                      <div className="font-medium text-sm">仅发送</div>
                      <p className="text-xs opacity-70 mt-1">推送本地变更</p>
                    </button>
                    
                    <button
                      onClick={() => setSyncMode('receive_only')}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        syncMode === 'receive_only'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-dark-500 bg-dark-600 text-dark-300 hover:border-dark-400'
                      }`}
                    >
                      <ArrowDown className="w-6 h-6 mx-auto mb-2" />
                      <div className="font-medium text-sm">仅接收</div>
                      <p className="text-xs opacity-70 mt-1">接收远程变更</p>
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <h4 className="text-sm font-medium text-blue-400 mb-2">💡 增量同步特性</h4>
                  <ul className="text-sm text-blue-300/80 space-y-1">
                    <li>• 使用 BLAKE3 哈希算法检测文件变更</li>
                    <li>• 1MB 分块传输，只传输变更的部分</li>
                    <li>• 实时文件系统监控，变更立即同步</li>
                    <li>• 支持跨子网 TCP 打洞优化传输</li>
                  </ul>
                </div>
              </div>

              <div className="flex justify-end gap-3 p-6 border-t border-dark-600">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setSelectedDevice(null);
                    setLocalPath('');
                  }}
                  className="btn btn-secondary"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateSession}
                  disabled={!selectedDevice || !localPath}
                  className="btn btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                  创建同步
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
