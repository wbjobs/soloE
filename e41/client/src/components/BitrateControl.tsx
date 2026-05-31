import React from 'react';
import { QualityLevel, NetworkStats } from '../types';

interface BitrateControlProps {
  currentLevel: QualityLevel;
  onLevelChange: (level: QualityLevel) => void;
  networkStats: NetworkStats;
}

const BitrateControl: React.FC<BitrateControlProps> = ({
  currentLevel,
  onLevelChange,
  networkStats
}) => {
  const levels: { id: QualityLevel; label: string; bitrate: string; color: string }[] = [
    { id: 'low', label: '低画质', bitrate: '300 kbps', color: '#22c55e' },
    { id: 'medium', label: '中画质', bitrate: '800 kbps', color: '#eab308' },
    { id: 'high', label: '高画质', bitrate: '1.5 Mbps', color: '#ef4444' }
  ];

  const getNetworkStatus = () => {
    if (networkStats.rtt < 100 && networkStats.packetLoss < 1) {
      return { status: '优秀', color: '#22c55e' };
    } else if (networkStats.rtt < 200 && networkStats.packetLoss < 5) {
      return { status: '良好', color: '#eab308' };
    } else {
      return { status: '较差', color: '#ef4444' };
    }
  };

  const networkStatus = getNetworkStatus();

  return (
    <div style={{
      backgroundColor: '#16213e',
      borderRadius: '12px',
      padding: '20px',
      marginTop: '20px'
    }}>
      <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#fff' }}>
        码率控制
      </h3>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px',
        marginBottom: '20px'
      }}>
        {levels.map((level) => (
          <button
            key={level.id}
            onClick={() => onLevelChange(level.id)}
            style={{
              padding: '12px 8px',
              borderRadius: '8px',
              border: currentLevel === level.id ? `2px solid ${level.color}` : '2px solid transparent',
              backgroundColor: currentLevel === level.id ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.05)',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>
              {level.label}
            </div>
            <div style={{ fontSize: '12px', color: level.color }}>
              {level.bitrate}
            </div>
          </button>
        ))}
      </div>

      <div style={{
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        paddingTop: '16px'
      }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#aaa' }}>
          网络状态
        </h4>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '12px'
        }}>
          <div style={{
            flex: 1,
            textAlign: 'center',
            padding: '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '6px'
          }}>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>RTT</div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>
              {networkStats.rtt.toFixed(0)} ms
            </div>
          </div>
          <div style={{
            flex: 1,
            textAlign: 'center',
            padding: '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '6px'
          }}>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>丢包率</div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>
              {networkStats.packetLoss.toFixed(1)}%
            </div>
          </div>
          <div style={{
            flex: 1,
            textAlign: 'center',
            padding: '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '6px'
          }}>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>质量</div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: networkStatus.color }}>
              {networkStatus.status}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BitrateControl;
