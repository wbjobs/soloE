import React, { useState } from 'react';
import { WebRTCState } from '../types';

interface ConnectionPanelProps {
  state: WebRTCState;
  roomPeers: string[];
  onCreateOffer: (remotePeerId: string) => void;
}

export const ConnectionPanel: React.FC<ConnectionPanelProps> = ({
  state,
  roomPeers,
  onCreateOffer
}) => {
  const [targetPeerId, setTargetPeerId] = useState('');

  const getStatusColor = (connected: boolean) => (connected ? '#22c55e' : '#ef4444');

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>连接状态</h2>

      <div style={styles.statusGrid}>
        <div style={styles.statusItem}>
          <span style={styles.label}>我的 ID:</span>
          <span style={styles.value}>{state.peerId}</span>
        </div>
        <div style={styles.statusItem}>
          <span style={styles.label}>房间:</span>
          <span style={styles.value}>{state.roomId}</span>
        </div>
        <div style={styles.statusItem}>
          <span style={styles.label}>P2P 连接:</span>
          <span
            style={{
              ...styles.statusBadge,
              backgroundColor: getStatusColor(state.isConnected)
            }}
          >
            {state.isConnected ? '已连接' : '未连接'}
          </span>
        </div>
        <div style={styles.statusItem}>
          <span style={styles.label}>数据通道:</span>
          <span
            style={{
              ...styles.statusBadge,
              backgroundColor: getStatusColor(state.isChannelOpen)
            }}
          >
            {state.isChannelOpen ? '已开启' : '未开启'}
          </span>
        </div>
        {state.remotePeerId && (
          <div style={styles.statusItem}>
            <span style={styles.label}>远端 Peer:</span>
            <span style={styles.value}>{state.remotePeerId}</span>
          </div>
        )}
        {state.connectionState && (
          <div style={styles.statusItem}>
            <span style={styles.label}>连接状态:</span>
            <span style={styles.value}>{state.connectionState}</span>
          </div>
        )}
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>房间内的用户</h3>
        {roomPeers.length === 0 ? (
          <p style={styles.emptyText}>暂无其他用户</p>
        ) : (
          <div style={styles.peerList}>
            {roomPeers.map((peer) => (
              <div key={peer} style={styles.peerItem}>
                <span style={styles.peerId}>{peer}</span>
                <button
                  style={styles.connectBtn}
                  onClick={() => onCreateOffer(peer)}
                  disabled={state.isConnected}
                >
                  连接
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>手动连接</h3>
        <div style={styles.inputRow}>
          <input
            type="text"
            style={styles.input}
            placeholder="输入目标 Peer ID"
            value={targetPeerId}
            onChange={(e) => setTargetPeerId(e.target.value)}
          />
          <button
            style={styles.connectBtn}
            onClick={() => {
              if (targetPeerId.trim()) {
                onCreateOffer(targetPeerId.trim());
              }
            }}
            disabled={state.isConnected || !targetPeerId.trim()}
          >
            发起连接
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '20px'
  },
  cardTitle: {
    margin: '0 0 20px 0',
    color: '#f1f5f9',
    fontSize: '18px',
    fontWeight: 600
  },
  statusGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '20px'
  },
  statusItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  label: {
    color: '#94a3b8',
    fontSize: '14px'
  },
  value: {
    color: '#f1f5f9',
    fontSize: '14px',
    fontFamily: 'monospace'
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 500,
    color: 'white'
  },
  section: {
    borderTop: '1px solid #334155',
    paddingTop: '16px',
    marginTop: '16px'
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    color: '#cbd5e1',
    fontSize: '14px',
    fontWeight: 500
  },
  emptyText: {
    color: '#64748b',
    fontSize: '14px',
    margin: 0
  },
  peerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  peerItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: '10px 12px',
    borderRadius: '8px'
  },
  peerId: {
    color: '#f1f5f9',
    fontFamily: 'monospace',
    fontSize: '13px'
  },
  connectBtn: {
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    padding: '6px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500
  },
  inputRow: {
    display: 'flex',
    gap: '10px'
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '6px',
    color: '#f1f5f9',
    fontSize: '14px',
    outline: 'none'
  }
};
