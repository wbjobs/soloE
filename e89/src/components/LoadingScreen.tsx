import React from 'react';

interface LoadingScreenProps {
  message: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ message }) => {
  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    color: '#fff',
    fontFamily: 'system-ui, sans-serif',
    zIndex: 1000,
  };

  const spinnerStyle: React.CSSProperties = {
    width: 60,
    height: 60,
    border: '4px solid rgba(96, 165, 250, 0.2)',
    borderTop: '4px solid #60a5fa',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: 24,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
    background: 'linear-gradient(135deg, #60a5fa, #a78bfa)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  };

  const messageStyle: React.CSSProperties = {
    fontSize: 14,
    color: '#94a3b8',
  };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <div style={spinnerStyle} />
      <h1 style={titleStyle}>WebGPU 体素光线追踪器</h1>
      <p style={messageStyle}>{message}</p>
    </div>
  );
};
