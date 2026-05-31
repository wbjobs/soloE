import React, { useState, useEffect } from 'react';
import { PacketRecord } from '../types';

interface PacketFlowPanelProps {
  packetRecords: PacketRecord[];
  isChannelOpen: boolean;
  onSendProbe: () => number;
}

export const PacketFlowPanel: React.FC<PacketFlowPanelProps> = ({
  packetRecords,
  isChannelOpen,
  onSendProbe
}) => {
  const [isSending, setIsSending] = useState(false);
  const [sendInterval, setSendInterval] = useState(100);
  const [sentCount, setSentCount] = useState(0);
  const sendIntervalRef = React.useRef<number | null>(null);

  const startSending = () => {
    if (sendIntervalRef.current) return;
    setIsSending(true);
    sendIntervalRef.current = window.setInterval(() => {
      const seq = onSendProbe();
      if (seq >= 0) {
        setSentCount((prev) => prev + 1);
      }
    }, sendInterval);
  };

  const stopSending = () => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }
    setIsSending(false);
  };

  useEffect(() => {
    return () => {
      if (sendIntervalRef.current) {
        clearInterval(sendIntervalRef.current);
      }
    };
  }, []);

  const recentPackets = packetRecords.slice(-20);

  const detectReorderInRecent = () => {
    let maxSeq = -1;
    let reorderCount = 0;
    for (const p of recentPackets) {
      if (p.seq < maxSeq) reorderCount++;
      else maxSeq = p.seq;
    }
    return reorderCount;
  };

  const reorderCount = detectReorderInRecent();

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>数据包流量</h2>

      <div style={styles.controlSection}>
        <div style={styles.controlRow}>
          <label style={styles.label}>发送间隔:</label>
          <select
            style={styles.select}
            value={sendInterval}
            onChange={(e) => setSendInterval(Number(e.target.value))}
            disabled={isSending}
          >
            <option value={50}>50ms</option>
            <option value={100}>100ms</option>
            <option value={200}>200ms</option>
            <option value={500}>500ms</option>
            <option value={1000}>1000ms</option>
          </select>
          {!isSending ? (
            <button
              style={styles.primaryBtn}
              onClick={startSending}
              disabled={!isChannelOpen}
            >
              开始发送探测包
            </button>
          ) : (
            <button style={styles.dangerBtn} onClick={stopSending}>
              停止发送
            </button>
          )}
          <button
            style={styles.secondaryBtn}
            onClick={() => onSendProbe()}
            disabled={!isChannelOpen}
          >
            单发
          </button>
        </div>
        <div style={styles.statsRow}>
          <span style={styles.statText}>已发送: <strong>{sentCount}</strong></span>
          <span style={styles.statText}>已接收: <strong>{packetRecords.length}</strong></span>
          <span style={styles.statText}>
            最近乱序: <strong style={{ color: reorderCount > 0 ? '#f97316' : '#22c55e' }}>
              {reorderCount}
            </strong>
          </span>
        </div>
      </div>

      {recentPackets.length > 0 && (
        <div style={styles.packetVisualization}>
          <h3 style={styles.sectionTitle}>最近 20 个包时序</h3>
          <div style={styles.packetRow}>
            {recentPackets.map((packet, idx) => {
              const isReordered = idx > 0 && packet.seq < recentPackets[idx - 1].seq;
              return (
                <div
                  key={`${packet.seq}-${idx}`}
                  style={{
                    ...styles.packetBar,
                    height: `${Math.min(100, Math.max(10, packet.latency))}%`,
                    backgroundColor: isReordered ? '#ef4444' : '#3b82f6',
                    opacity: isReordered ? 1 : 0.7 + (packet.latency / 500) * 0.3
                  }}
                  title={`Seq: ${packet.seq}, Latency: ${packet.latency}ms${isReordered ? ' (乱序!)' : ''}`}
                />
              );
            })}
          </div>
          <div style={styles.legend}>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendDot, backgroundColor: '#3b82f6' }} />
              <span>正常顺序</span>
            </div>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendDot, backgroundColor: '#ef4444' }} />
              <span>乱序包</span>
            </div>
            <span style={styles.legendNote}>高度 = 延迟大小</span>
          </div>
        </div>
      )}
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
  controlSection: {
    marginBottom: '20px'
  },
  controlRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: '12px'
  },
  label: {
    color: '#94a3b8',
    fontSize: '14px'
  },
  select: {
    padding: '8px 12px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '6px',
    color: '#f1f5f9',
    fontSize: '14px'
  },
  primaryBtn: {
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  dangerBtn: {
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  secondaryBtn: {
    backgroundColor: '#334155',
    color: '#f1f5f9',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  statsRow: {
    display: 'flex',
    gap: '24px',
    padding: '12px',
    backgroundColor: '#0f172a',
    borderRadius: '8px'
  },
  statText: {
    color: '#94a3b8',
    fontSize: '14px'
  },
  packetVisualization: {
    borderTop: '1px solid #334155',
    paddingTop: '16px'
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    color: '#cbd5e1',
    fontSize: '14px',
    fontWeight: 500
  },
  packetRow: {
    display: 'flex',
    alignItems: 'flex-end',
    height: '120px',
    gap: '4px',
    backgroundColor: '#0f172a',
    padding: '12px',
    borderRadius: '8px',
    overflowX: 'auto'
  },
  packetBar: {
    width: '8px',
    minHeight: '4px',
    borderRadius: '2px',
    transition: 'all 0.2s ease',
    flexShrink: 0
  },
  legend: {
    display: 'flex',
    gap: '20px',
    alignItems: 'center',
    marginTop: '12px'
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  legendDot: {
    width: '12px',
    height: '12px',
    borderRadius: '2px'
  },
  legendNote: {
    color: '#64748b',
    fontSize: '12px',
    marginLeft: 'auto'
  }
};
