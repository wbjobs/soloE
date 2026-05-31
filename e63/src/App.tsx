import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import './App.css';
import DeviceList from './components/DeviceList';
import FileSelector from './components/FileSelector';
import TransferManager from './components/TransferManager';
import QrCodeModal from './components/QrCodeModal';
import ReportList from './components/ReportList';
import { Device, FileInfo, TransferSession, QrCodePayload } from './types';

function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [transfers, setTransfers] = useState<Map<string, TransferSession>>(new Map());
  const [deviceName] = useState(`Device-${Math.floor(Math.random() * 1000)}`);
  const [showQrModal, setShowQrModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'transfer' | 'reports'>('transfer');

  useEffect(() => {
    startDiscovery();
  }, []);

  useEffect(() => {
    const interval = setInterval(refreshDevices, 5000);
    return () => clearInterval(interval);
  }, []);

  const startDiscovery = async () => {
    try {
      await invoke('start_discovery');
      await invoke('announce_self', { deviceName, port: 8888 });
    } catch (e) {
      console.error('Failed to start discovery:', e);
    }
  };

  const refreshDevices = async () => {
    try {
      const discovered: Device[] = await invoke('get_discovered_devices');
      setDevices(discovered);
    } catch (e) {
      console.error('Failed to get devices:', e);
    }
  };

  const handleSelectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
      });

      if (selected && typeof selected === 'string') {
        const fileInfo: FileInfo = await invoke('open_file', { path: selected });
        setSelectedFile(fileInfo);
      }
    } catch (e) {
      console.error('Failed to select file:', e);
    }
  };

  const toggleDeviceSelection = (deviceId: string) => {
    setSelectedDevices((prev) =>
      prev.includes(deviceId)
        ? prev.filter((id) => id !== deviceId)
        : [...prev, deviceId]
    );
  };

  const handleQrConnect = (payload: QrCodePayload) => {
    console.log('Connecting to device via QR:', payload);
    const device: Device = {
      id: payload.device_id,
      name: payload.device_name,
      address: payload.address,
      port: payload.port,
      last_seen: Math.floor(Date.now() / 1000),
    };
    setDevices((prev) => {
      const existing = prev.find((d) => d.id === device.id);
      if (existing) {
        return prev.map((d) => (d.id === device.id ? device : d));
      }
      return [...prev, device];
    });
    setSelectedDevices([payload.device_id]);
  };

  const startTransfer = () => {
    if (!selectedFile || selectedDevices.length === 0) return;

    selectedDevices.forEach((deviceId) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return;

      const sessionId = `${selectedFile.file_id}-${deviceId}`;
      const session: TransferSession = {
        sessionId,
        fileId: selectedFile.file_id,
        fileName: selectedFile.name,
        peerId: deviceId,
        peerName: device.name,
        totalChunks: selectedFile.total_chunks,
        transferredChunks: 0,
        bytesTransferred: 0,
        speed: 0,
        status: 'transferring',
        startTime: Date.now(),
        direction: 'send',
      };

      setTransfers((prev) => new Map(prev).set(sessionId, session));
    });
  };

  const updateTransferProgress = (sessionId: string, chunkIndex: number, bytes: number) => {
    setTransfers((prev) => {
      const updated = new Map(prev);
      const session = updated.get(sessionId);
      if (session) {
        const elapsed = (Date.now() - session.startTime) / 1000;
        session.transferredChunks = chunkIndex + 1;
        session.bytesTransferred = bytes;
        session.speed = bytes / Math.max(elapsed, 0.1);
        if (session.transferredChunks >= session.totalChunks) {
          session.status = 'completed';
        }
      }
      return updated;
    });
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>P2P 文件传输</h1>
          <p>设备名称: {deviceName}</p>
        </div>
        <div className="header-right">
          <button className="btn btn-secondary qr-btn" onClick={() => setShowQrModal(true)}>
            📱 二维码连接
          </button>
        </div>
      </header>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'transfer' ? 'active' : ''}`}
          onClick={() => setActiveTab('transfer')}
        >
          传输
        </button>
        <button
          className={`tab ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          报告
        </button>
      </div>

      <main className="app-main">
        {activeTab === 'transfer' ? (
          <>
            <div className="left-panel">
              <FileSelector
                selectedFile={selectedFile}
                onSelectFile={handleSelectFile}
              />
              <DeviceList
                devices={devices}
                selectedDevices={selectedDevices}
                onToggleDevice={toggleDeviceSelection}
                onRefresh={refreshDevices}
              />
            </div>

            <div className="right-panel">
              <TransferManager
                transfers={transfers}
                selectedFile={selectedFile}
                selectedDevices={selectedDevices}
                onStartTransfer={startTransfer}
                onUpdateProgress={updateTransferProgress}
              />
            </div>
          </>
        ) : (
          <div className="full-panel">
            <ReportList />
          </div>
        )}
      </main>

      <QrCodeModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        deviceName={deviceName}
        onConnect={handleQrConnect}
      />
    </div>
  );
}

export default App;
