import React, { useState } from 'react';

interface JoinFormProps {
  onJoin: (roomId: string, clientName: string) => void;
}

const JoinForm: React.FC<JoinFormProps> = ({ onJoin }) => {
  const [roomId, setRoomId] = useState('conference-1');
  const [clientName, setClientName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim() && clientName.trim()) {
      onJoin(roomId.trim(), clientName.trim());
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#1a1a2e'
    }}>
      <div style={{
        backgroundColor: '#16213e',
        borderRadius: '16px',
        padding: '40px',
        width: '100%',
        maxWidth: '400px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎥</div>
          <h1 style={{
            margin: 0,
            fontSize: '28px',
            color: '#fff',
            marginBottom: '8px'
          }}>
            WebRTC 会议系统
          </h1>
          <p style={{
            margin: 0,
            color: '#888',
            fontSize: '14px'
          }}>
            支持最多 4 人同时视频会议
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500
            }}>
              会议室 ID
            </label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="输入会议室 ID"
              style={{
                width: '100%',
                padding: '14px 16px',
                backgroundColor: '#0f3460',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '16px',
                outline: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: '28px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500
            }}>
              您的昵称
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="输入您的昵称"
              style={{
                width: '100%',
                padding: '14px 16px',
                backgroundColor: '#0f3460',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '16px',
                outline: 'none'
              }}
            />
          </div>

          <button
            type="submit"
            disabled={!roomId.trim() || !clientName.trim()}
            style={{
              width: '100%',
              padding: '16px',
              backgroundColor: (!roomId.trim() || !clientName.trim()) ? '#444' : '#e94560',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '16px',
              fontWeight: 600,
              cursor: (!roomId.trim() || !clientName.trim()) ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s ease'
            }}
          >
            加入会议
          </button>
        </form>

        <div style={{
          marginTop: '24px',
          padding: '16px',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '8px'
        }}>
          <h4 style={{ margin: '0 0 8px 0', color: '#fff', fontSize: '14px' }}>
            功能说明
          </h4>
          <ul style={{
            margin: 0,
            paddingLeft: '16px',
            color: '#888',
            fontSize: '12px',
            lineHeight: '1.8'
          }}>
            <li>支持 4 人同时加入会议</li>
            <li>三档码率控制：300kbps / 800kbps / 1.5Mbps</li>
            <li>实时网络状态监测（RTT / 丢包率）</li>
            <li>SFU 智能转发优化</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default JoinForm;
