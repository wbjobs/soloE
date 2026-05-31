import React, { useState, useEffect, useCallback } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useDetection } from './hooks/useDetection';
import { ConnectionPanel } from './components/ConnectionPanel';
import { DetectionPanel } from './components/DetectionPanel';
import { PacketFlowPanel } from './components/PacketFlowPanel';
import { DecodingPanel } from './components/DecodingPanel';
import { getSocket } from './utils/socket';
import { PacketRecord, DetectionReport } from './types';

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

const App: React.FC = () => {
  const [peerId] = useState(() => generateId());
  const [roomId, setRoomId] = useState('test-room-001');
  const [roomInput, setRoomInput] = useState('test-room-001');
  const [roomPeers, setRoomPeers] = useState<string[]>([]);
  const [packetRecords, setPacketRecords] = useState<PacketRecord[]>([]);
  const [alerts, setAlerts] = useState<DetectionReport[]>([]);

  const {
    state,
    connectionError,
    isReconnecting,
    createOffer,
    sendProbePacket,
    getPacketRecords,
    clearPacketRecords,
    setOnPacketReceived,
    resetConnection
  } = useWebRTC(peerId, roomId);

  const {
    metrics,
    reportHistory,
    isAnalyzing,
    baseline,
    decodingResult,
    isDecoding,
    decodingHistory,
    analyzeCurrent,
    startAutoAnalysis,
    stopAutoAnalysis,
    resetBaseline,
    forceRebuildBaseline,
    performDecoding,
    exportHex,
    exportText,
    downloadFile,
    fetchHistory,
    fetchDecodingHistory
  } = useDetection(roomId, peerId, getPacketRecords);

  useEffect(() => {
    setOnPacketReceived((record: PacketRecord) => {
      setPacketRecords((prev) => [...prev.slice(-499), record]);
    });
  }, [setOnPacketReceived]);

  useEffect(() => {
    const socket = getSocket();

    const onRoomPeers = (peers: string[]) => {
      setRoomPeers(peers);
    };

    const onPeerJoined = (joinedPeerId: string) => {
      setRoomPeers((prev) => (prev.includes(joinedPeerId) ? prev : [...prev, joinedPeerId]));
    };

    const onPeerLeft = (leftPeerId: string) => {
      setRoomPeers((prev) => prev.filter((p) => p !== leftPeerId));
    };

    const onHighSuspicionAlert = (report: DetectionReport) => {
      setAlerts((prev) => [...prev.slice(-9), report]);
    };

    socket.on('room-peers', onRoomPeers);
    socket.on('peer-joined', onPeerJoined);
    socket.on('peer-left', onPeerLeft);
    socket.on('high-suspicion-alert', onHighSuspicionAlert);

    return () => {
      socket.off('room-peers', onRoomPeers);
      socket.off('peer-joined', onPeerJoined);
      socket.off('peer-left', onPeerLeft);
      socket.off('high-suspicion-alert', onHighSuspicionAlert);
    };
  }, []);

  const handleJoinRoom = () => {
    if (roomInput.trim()) {
      setRoomId(roomInput.trim());
      window.location.reload();
    }
  };

  const handleClearData = useCallback(() => {
    clearPacketRecords();
    setPacketRecords([]);
  }, [clearPacketRecords]);

  const dismissAlert = (index: number) => {
    setAlerts((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div>
            <h1 style={styles.title}>WebRTC 隐蔽信道检测器</h1>
            <p style={styles.subtitle}>检测 DataChannel 中的延迟抖动和包序重排隐蔽信道</p>
          </div>
          <div style={styles.roomSelector}>
            <input
              type="text"
              style={styles.roomInput}
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="房间 ID"
            />
            <button style={styles.roomBtn} onClick={handleJoinRoom}>
              加入房间
            </button>
          </div>
        </div>
      </header>

      {(connectionError || isReconnecting || alerts.length > 0) && (
        <div style={styles.alertsContainer}>
          {connectionError && (
            <div style={{ ...styles.alert, backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
              <div style={styles.alertHeader}>
                <span style={styles.alertIcon}>❌</span>
                <span style={{ ...styles.alertTitle, color: '#fca5a5' }}>连接错误</span>
                <button style={styles.alertClose} onClick={() => resetConnection()}>
                  ×
                </button>
              </div>
              <div style={{ ...styles.alertContent, color: '#fecaca' }}>
                <p>{connectionError}</p>
                <button style={styles.reconnectBtn} onClick={() => resetConnection()}>
                  重置连接
                </button>
              </div>
            </div>
          )}

          {isReconnecting && !connectionError && (
            <div style={{ ...styles.alert, backgroundColor: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
              <div style={styles.alertHeader}>
                <span style={styles.alertIcon}>🔄</span>
                <span style={{ ...styles.alertTitle, color: '#60a5fa' }}>正在重连...</span>
              </div>
              <div style={{ ...styles.alertContent, color: '#93c5fd' }}>
                <p>检测到连接断开，正在尝试重新建立连接...</p>
              </div>
            </div>
          )}

          {alerts.map((alert, idx) => (
            <div key={idx} style={styles.alert}>
              <div style={styles.alertHeader}>
                <span style={styles.alertIcon}>⚠️</span>
                <span style={styles.alertTitle}>高风险隐蔽信道警告</span>
                <button style={styles.alertClose} onClick={() => dismissAlert(idx)}>
                  ×
                </button>
              </div>
              <div style={styles.alertContent}>
                <p>
                  检测到来自 <strong>{alert.peerId}</strong> 的高可疑流量
                </p>
                <p>
                  可疑度: <strong style={{ color: '#ef4444' }}>
                    {(alert.overallSuspicion * 100).toFixed(1)}%
                  </strong>
                  {' | '}
                  乱序包: {alert.reorderedPackets}/{alert.totalPackets}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <main style={styles.main}>
        <div style={styles.leftColumn}>
          <ConnectionPanel
            state={state}
            roomPeers={roomPeers}
            onCreateOffer={createOffer}
          />
          <PacketFlowPanel
            packetRecords={packetRecords}
            isChannelOpen={state.isChannelOpen}
            onSendProbe={sendProbePacket}
          />
        </div>

        <div style={styles.rightColumn}>
          <DetectionPanel
            metrics={metrics}
            reportHistory={reportHistory}
            isAnalyzing={isAnalyzing}
            isChannelOpen={state.isChannelOpen}
            baseline={baseline}
            onAnalyze={analyzeCurrent}
            onStartAuto={startAutoAnalysis}
            onStopAuto={stopAutoAnalysis}
            onClear={handleClearData}
            onResetBaseline={resetBaseline}
            onRebuildBaseline={forceRebuildBaseline}
            onFetchHistory={() => fetchHistory(false)}
          />
          <DecodingPanel
            decodingResult={decodingResult}
            decodingHistory={decodingHistory}
            isDecoding={isDecoding}
            suspicionScore={metrics?.overallSuspicion || 0}
            onDecode={performDecoding}
            onExportHex={exportHex}
            onExportText={exportText}
            onDownloadFile={downloadFile}
            onFetchHistory={fetchDecodingHistory}
          />
        </div>
      </main>

      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f1f5f9'
  },
  header: {
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
    padding: '20px 32px'
  },
  headerContent: {
    maxWidth: '1400px',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 700,
    color: '#f1f5f9'
  },
  subtitle: {
    margin: '4px 0 0 0',
    fontSize: '14px',
    color: '#94a3b8'
  },
  roomSelector: {
    display: 'flex',
    gap: '10px'
  },
  roomInput: {
    padding: '8px 14px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#f1f5f9',
    fontSize: '14px',
    outline: 'none',
    width: '150px'
  },
  roomBtn: {
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    padding: '8px 20px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  alertsContainer: {
    maxWidth: '1400px',
    margin: '16px auto 0',
    padding: '0 32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  alert: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '12px',
    padding: '16px 20px'
  },
  alertHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '8px'
  },
  alertIcon: {
    fontSize: '20px'
  },
  alertTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#fca5a5'
  },
  alertClose: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    color: '#fca5a5',
    fontSize: '24px',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1
  },
  alertContent: {
    color: '#fecaca',
    fontSize: '14px'
  },
  reconnectBtn: {
    marginTop: '10px',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    color: '#fca5a5',
    border: '1px solid rgba(239, 68, 68, 0.4)',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  main: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '24px 32px',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px'
  },
  leftColumn: {
    display: 'flex',
    flexDirection: 'column'
  },
  rightColumn: {
    display: 'flex',
    flexDirection: 'column'
  }
};

export default App;
