import { useState, useEffect } from 'react';
import { RefreshCw, Wifi, Send, X, Loader2, Plus, Globe, Zap, Server } from 'lucide-react';
import { DeviceCard } from '../components/DeviceCard';
import { FileDropZone } from '../components/FileDropZone';
import { useAppStore } from '../store';
import { useDeviceDiscovery } from '../hooks/useDeviceDiscovery';
import type { DeviceInfo, FileItem } from '../types';

export function Devices() {
  const { devices, setDevices, selectedDevice, setSelectedDevice } = useAppStore();
  const { 
    isLoading, 
    isConnecting, 
    holePunchAttempt, 
    error, 
    refresh, 
    manualConnect, 
    tryTcpHolePunch,
    getOnlineDevicesViaSignaling 
  } = useDeviceDiscovery();
  
  const [showSendModal, setShowSendModal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [showManualConnect, setShowManualConnect] = useState(false);
  const [showSignalingDevices, setShowSignalingDevices] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [manualPort, setManualPort] = useState('58778');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [signalingDevices, setSignalingDevices] = useState<DeviceInfo[]>([]);

  useEffect(() => {
    const mockDevices: DeviceInfo[] = [
      {
        id: 'device-1',
        name: 'MacBook Pro (WiFi)',
        ip: '192.168.1.100',
        port: 58778,
        os: 'macos',
        status: 'online',
        lastSeen: Date.now(),
        connectionMethod: 'broadcast',
      },
      {
        id: 'device-2',
        name: 'Windows PC (Ethernet)',
        ip: '192.168.2.50',
        port: 58778,
        os: 'windows',
        status: 'online',
        lastSeen: Date.now(),
        connectionMethod: 'manual',
      },
    ];
    setDevices(mockDevices);
  }, [setDevices]);

  const handleSelectDevice = (device: DeviceInfo) => {
    if (device.status === 'online') {
      setSelectedDevice(device);
      setShowSendModal(true);
    }
  };

  const handleStartTransfer = () => {
    setShowSendModal(false);
    setSelectedFiles([]);
    setSelectedDevice(null);
  };

  const handleManualConnect = async () => {
    setConnectError(null);
    if (!manualIp) {
      setConnectError('请输入IP地址');
      return;
    }

    const port = parseInt(manualPort, 10) || 58778;
    const result = await manualConnect(manualIp, port);
    
    if (result.success) {
      setShowManualConnect(false);
      setManualIp('');
      setManualPort('58778');
    } else {
      setConnectError(result.error || '连接失败');
    }
  };

  const handleHolePunch = async (device: DeviceInfo) => {
    await tryTcpHolePunch(device.ip, device.port);
  };

  const handleLoadSignalingDevices = async () => {
    const devices = await getOnlineDevicesViaSignaling();
    setSignalingDevices(devices);
    setShowSignalingDevices(true);
  };

  const getConnectionMethodIcon = (method?: string) => {
    switch (method) {
      case 'broadcast':
        return <Wifi className="w-4 h-4" />;
      case 'manual':
        return <Plus className="w-4 h-4" />;
      case 'tcp_hole_punch':
        return <Zap className="w-4 h-4" />;
      case 'signaling_server':
        return <Server className="w-4 h-4" />;
      default:
        return <Globe className="w-4 h-4" />;
    }
  };

  const getConnectionMethodLabel = (method?: string) => {
    switch (method) {
      case 'broadcast':
        return '局域网广播';
      case 'manual':
        return '手动连接';
      case 'tcp_hole_punch':
        return 'TCP打洞';
      case 'signaling_server':
        return '信令服务器';
      default:
        return '未知';
    }
  };

  const onlineDevices = devices.filter((d) => d.status === 'online');
  const offlineDevices = devices.filter((d) => d.status !== 'online');

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">设备发现</h1>
            <p className="text-dark-300">发现同一局域网或跨子网的其他设备</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleLoadSignalingDevices}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Server className="w-4 h-4" />
              信令设备
            </button>
            <button
              onClick={() => setShowManualConnect(true)}
              className="btn btn-secondary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              手动连接
            </button>
            <button
              onClick={refresh}
              disabled={isLoading}
              className="btn btn-primary flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              {isLoading ? '扫描中...' : '刷新'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {holePunchAttempt && (
          <div className="mb-6 p-4 bg-primary/10 border border-primary/30 rounded-lg">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-primary animate-pulse" />
              <div>
                <div className="text-white font-medium">TCP打洞尝试中...</div>
                <div className="text-sm text-dark-300">
                  目标: {holePunchAttempt.targetIp}:{holePunchAttempt.targetPort} - 
                  尝试次数: {holePunchAttempt.attempts}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            在线设备 ({onlineDevices.length})
          </h2>
          {onlineDevices.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {onlineDevices.map((device) => (
                <div key={device.id} className="relative">
                  <DeviceCard
                    device={device}
                    onSelect={handleSelectDevice}
                    isSelected={selectedDevice?.id === device.id}
                  />
                  {device.connectionMethod && (
                    <div className="absolute top-4 right-4 flex items-center gap-1 px-2 py-1 bg-dark-700/80 rounded-full text-xs text-dark-300">
                      {getConnectionMethodIcon(device.connectionMethod)}
                      {getConnectionMethodLabel(device.connectionMethod)}
                    </div>
                  )}
                  {device.connectionMethod !== 'broadcast' && device.status === 'online' && (
                    <div className="absolute bottom-4 right-4">
                      <button
                        onClick={() => handleHolePunch(device)}
                        disabled={isConnecting}
                        className="p-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                        title="尝试TCP打洞优化连接"
                      >
                        <Zap className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-12 text-center">
              <div className="w-20 h-20 rounded-2xl bg-dark-600 flex items-center justify-center mx-auto mb-4">
                {isLoading ? (
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                ) : (
                  <Wifi className="w-10 h-10 text-dark-400" />
                )}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                {isLoading ? '正在扫描...' : '未发现设备'}
              </h3>
              <p className="text-dark-300 mb-4">
                确保其他设备在同一网络或尝试手动输入IP连接
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setShowManualConnect(true)}
                  className="btn btn-secondary"
                >
                  手动连接
                </button>
                <button onClick={refresh} disabled={isLoading} className="btn btn-primary">
                  重新扫描
                </button>
              </div>
            </div>
          )}
        </div>

        {offlineDevices.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2 opacity-60">
              <span className="w-2 h-2 rounded-full bg-dark-400" />
              离线设备 ({offlineDevices.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
              {offlineDevices.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  onSelect={() => {}}
                />
              ))}
            </div>
          </div>
        )}

        {showManualConnect && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="card w-full max-w-md">
              <div className="flex items-center justify-between p-6 border-b border-dark-600">
                <div>
                  <h3 className="text-lg font-semibold text-white">手动连接设备</h3>
                  <p className="text-sm text-dark-300">输入目标设备的IP地址建立连接</p>
                </div>
                <button
                  onClick={() => {
                    setShowManualConnect(false);
                    setConnectError(null);
                  }}
                  className="p-2 rounded-lg hover:bg-dark-600 text-dark-300 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    IP 地址
                  </label>
                  <input
                    type="text"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    placeholder="例如: 192.168.1.100"
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    端口号
                  </label>
                  <input
                    type="number"
                    value={manualPort}
                    onChange={(e) => setManualPort(e.target.value)}
                    placeholder="58778"
                    className="input"
                  />
                </div>

                {connectError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {connectError}
                  </div>
                )}

                <div className="p-4 bg-dark-700/50 rounded-lg">
                  <h4 className="text-sm font-medium text-white mb-2">💡 提示</h4>
                  <ul className="text-sm text-dark-300 space-y-1">
                    <li>• 确保目标设备正在运行应用</li>
                    <li>• 确认设备在同一局域网或可路由网络</li>
                    <li>• 跨子网连接会自动尝试TCP打洞优化</li>
                    <li>• 如仍无法连接，可尝试配置信令服务器</li>
                  </ul>
                </div>
              </div>

              <div className="flex justify-end gap-3 p-6 border-t border-dark-600">
                <button
                  onClick={() => {
                    setShowManualConnect(false);
                    setConnectError(null);
                  }}
                  className="btn btn-secondary"
                >
                  取消
                </button>
                <button
                  onClick={handleManualConnect}
                  disabled={isConnecting || !manualIp}
                  className="btn btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      连接中...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      连接
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {showSignalingDevices && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="card w-full max-w-lg max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between p-6 border-b border-dark-600">
                <div>
                  <h3 className="text-lg font-semibold text-white">信令服务器设备</h3>
                  <p className="text-sm text-dark-300">通过中心化信令服务器发现的设备</p>
                </div>
                <button
                  onClick={() => setShowSignalingDevices(false)}
                  className="p-2 rounded-lg hover:bg-dark-600 text-dark-300 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {signalingDevices.length > 0 ? (
                  <div className="space-y-3">
                    {signalingDevices.map((device) => (
                      <div
                        key={device.id}
                        className="p-4 bg-dark-700/50 rounded-lg hover:bg-dark-600/50 transition-colors cursor-pointer"
                        onClick={() => handleSelectDevice(device)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Server className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <div className="font-medium text-white">{device.name}</div>
                              <div className="text-sm text-dark-300 font-mono">
                                {device.publicIp || device.ip}:{device.port}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-sm text-green-400">在线</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Server className="w-16 h-16 text-dark-400 mx-auto mb-4" />
                    <p className="text-dark-300">信令服务器上暂无设备</p>
                    <p className="text-sm text-dark-400 mt-2">
                      请确保已在设置中启用并配置信令服务器
                    </p>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-dark-600">
                <button
                  onClick={handleLoadSignalingDevices}
                  className="btn btn-secondary w-full flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  刷新列表
                </button>
              </div>
            </div>
          </div>
        )}

        {showSendModal && selectedDevice && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="card w-full max-w-xl max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between p-6 border-b border-dark-600">
                <div>
                  <h3 className="text-lg font-semibold text-white">发送文件到</h3>
                  <p className="text-sm text-dark-300">
                    {selectedDevice.name} ({selectedDevice.ip})
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowSendModal(false);
                    setSelectedFiles([]);
                    setSelectedDevice(null);
                  }}
                  className="p-2 rounded-lg hover:bg-dark-600 text-dark-300 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6">
                <FileDropZone
                  files={selectedFiles}
                  onFilesChange={setSelectedFiles}
                />
              </div>

              <div className="flex justify-end gap-3 p-6 border-t border-dark-600">
                <button
                  onClick={() => {
                    setShowSendModal(false);
                    setSelectedFiles([]);
                    setSelectedDevice(null);
                  }}
                  className="btn btn-secondary"
                >
                  取消
                </button>
                <button
                  onClick={handleStartTransfer}
                  disabled={selectedFiles.length === 0}
                  className="btn btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  开始发送
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
