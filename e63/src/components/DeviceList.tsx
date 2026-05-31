import { Device } from '../types';
import { invoke } from '@tauri-apps/api/core';

interface DeviceListProps {
  devices: Device[];
  selectedDevices: string[];
  onToggleDevice: (deviceId: string) => void;
  onRefresh: () => void;
}

export default function DeviceList({
  devices,
  selectedDevices,
  onToggleDevice,
  onRefresh,
}: DeviceListProps) {
  const handleManualRefresh = async () => {
    try {
      await invoke('refresh_discovery');
    } catch (e) {
      console.error('Refresh failed:', e);
    }
    onRefresh();
  };

  return (
    <div className="card">
      <div className="device-list-header">
        <h2 className="card-title">发现的设备 ({devices.length})</h2>
        <button className="refresh-btn" onClick={handleManualRefresh} title="刷新设备列表">
          🔄
        </button>
      </div>

      {devices.length === 0 ? (
        <div className="no-devices">
          <p>未发现其他设备</p>
          <p style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
            请确保其他设备也在同一局域网并运行此应用
          </p>
          <button 
            className="btn btn-secondary"
            style={{ marginTop: '1rem', width: '100%' }}
            onClick={handleManualRefresh}
          >
            立即扫描
          </button>
        </div>
      ) : (
        devices.map((device) => (
          <div
            key={device.id}
            className={`device-item ${selectedDevices.includes(device.id) ? 'selected' : ''}`}
            onClick={() => onToggleDevice(device.id)}
          >
            <input
              type="checkbox"
              className="device-checkbox"
              checked={selectedDevices.includes(device.id)}
              onChange={() => {}}
            />
            <div className="device-info">
              <div className="device-name">
                {device.name}
                <span style={{ 
                  marginLeft: '0.5rem', 
                  fontSize: '0.7rem', 
                  color: 'rgba(255,255,255,0.5)' 
                }}>
                  {new Date(device.last_seen * 1000).toLocaleTimeString()}
                </span>
              </div>
              <div className="device-address">
                {device.address}:{device.port}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
