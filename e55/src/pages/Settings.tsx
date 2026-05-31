import { useState } from 'react';
import { Save, Monitor, Folder, Shield, Wifi, Info, Zap, Server } from 'lucide-react';
import { useAppStore } from '../store';
import type { AppSettings } from '../types';

export function Settings() {
  const { settings, updateSettings } = useAppStore();
  const [localSettings, setLocalSettings] = useState<AppSettings>(settings);
  const [hasChanges, setHasChanges] = useState(false);

  const handleChange = (key: keyof AppSettings, value: any) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateSettings(localSettings);
    setHasChanges(false);
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">设置</h1>
            <p className="text-dark-300">配置应用程序的各项参数</p>
          </div>
          {hasChanges && (
            <button onClick={handleSave} className="btn btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" />
              保存更改
            </button>
          )}
        </div>

        <div className="space-y-6">
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Monitor className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">设备设置</h2>
                <p className="text-sm text-dark-300">配置当前设备的显示信息</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">设备名称</label>
                <input
                  type="text"
                  value={localSettings.deviceName}
                  onChange={(e) => handleChange('deviceName', e.target.value)}
                  placeholder="输入设备名称"
                  className="input"
                />
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center">
                <Folder className="w-5 h-5 text-secondary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">文件存储</h2>
                <p className="text-sm text-dark-300">配置文件接收和存储选项</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">默认保存路径</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={localSettings.savePath || '下载目录'}
                    readOnly
                    className="input flex-1 bg-dark-700"
                  />
                  <button className="btn btn-secondary">浏览</button>
                </div>
              </div>

              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-white">自动接收文件</div>
                  <div className="text-sm text-dark-300">来自可信设备的文件将自动接收</div>
                </div>
                <button
                  onClick={() => handleChange('autoAccept', !localSettings.autoAccept)}
                  className={`switch ${
                    localSettings.autoAccept ? 'switch-active' : 'switch-inactive'
                  }`}
                >
                  <span
                    className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      localSettings.autoAccept ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
                <Wifi className="w-5 h-5 text-warning" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">网络设置</h2>
                <p className="text-sm text-dark-300">配置设备发现和传输端口</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">发现端口</label>
                <input
                  type="number"
                  value={localSettings.discoveryPort}
                  onChange={(e) => handleChange('discoveryPort', parseInt(e.target.value))}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-2">传输端口</label>
                <input
                  type="number"
                  value={localSettings.transferPort}
                  onChange={(e) => handleChange('transferPort', parseInt(e.target.value))}
                  className="input"
                />
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <Zap className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">跨子网连接</h2>
                <p className="text-sm text-dark-300">配置TCP打洞和信令服务器选项</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-white">启用TCP打洞</div>
                  <div className="text-sm text-dark-300">跨子网连接时自动尝试TCP打洞优化传输速度</div>
                </div>
                <button
                  onClick={() => handleChange('enableHolePunch', !localSettings.enableHolePunch)}
                  className={`switch ${
                    localSettings.enableHolePunch ? 'switch-active' : 'switch-inactive'
                  }`}
                >
                  <span
                    className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      localSettings.enableHolePunch ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">打洞尝试次数</label>
                <input
                  type="number"
                  value={localSettings.holePunchAttempts}
                  onChange={(e) => handleChange('holePunchAttempts', parseInt(e.target.value))}
                  min={1}
                  max={10}
                  className="input"
                />
                <p className="text-xs text-dark-400 mt-1">推荐3-5次，过多可能导致连接延迟</p>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Server className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">信令服务器</h2>
                <p className="text-sm text-dark-300">配置中心化信令服务器用于跨网络设备发现</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium text-white">启用信令服务器</div>
                  <div className="text-sm text-dark-300">通过服务器发现不同网络中的设备</div>
                </div>
                <button
                  onClick={() => handleChange('enableSignaling', !localSettings.enableSignaling)}
                  className={`switch ${
                    localSettings.enableSignaling ? 'switch-active' : 'switch-inactive'
                  }`}
                >
                  <span
                    className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      localSettings.enableSignaling ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">服务器地址</label>
                <input
                  type="text"
                  value={localSettings.signalingServerUrl}
                  onChange={(e) => handleChange('signalingServerUrl', e.target.value)}
                  placeholder="wss://signaling.example.com"
                  disabled={!localSettings.enableSignaling}
                  className="input disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-xs text-dark-400 mt-1">WebSocket服务地址，用于设备间通信中继</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-white mb-2">API密钥（可选）</label>
                <input
                  type="password"
                  value={localSettings.signalingApiKey || ''}
                  onChange={(e) => handleChange('signalingApiKey', e.target.value)}
                  placeholder="输入API密钥"
                  disabled={!localSettings.enableSignaling}
                  className="input disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="text-xs text-dark-400 mt-1">部分私有信令服务器可能需要认证</p>
              </div>

              <div className="p-4 bg-dark-700/50 rounded-lg">
                <h4 className="text-sm font-medium text-white mb-2">💡 使用说明</h4>
                <ul className="text-sm text-dark-300 space-y-1">
                  <li>• 信令服务器帮助发现不同局域网或互联网中的设备</li>
                  <li>• 仅用于交换连接信息，实际文件传输仍为P2P</li>
                  <li>• 可自行部署开源信令服务器或使用公共服务</li>
                  <li>• 启用后将定期向服务器上报在线状态</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">安全设置</h2>
                <p className="text-sm text-dark-300">配置加密和安全选项</p>
              </div>
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium text-white">启用传输加密</div>
                <div className="text-sm text-dark-300">使用 TLS 加密所有文件传输</div>
              </div>
              <button
                onClick={() => handleChange('enableEncryption', !localSettings.enableEncryption)}
                className={`switch ${
                  localSettings.enableEncryption ? 'switch-active' : 'switch-inactive'
                }`}
              >
                <span
                  className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    localSettings.enableEncryption ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-dark-500 flex items-center justify-center">
                <Info className="w-5 h-5 text-dark-300" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">关于</h2>
                <p className="text-sm text-dark-300">应用程序信息</p>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-dark-300">版本</span>
                <span className="text-white">1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-300">平台</span>
                <span className="text-white">Tauri + React + TypeScript</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-300">许可证</span>
                <span className="text-white">MIT</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
