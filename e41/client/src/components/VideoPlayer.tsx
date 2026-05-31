import React, { useEffect, useRef } from 'react';

interface VideoPlayerProps {
  track: MediaStreamTrack | null;
  isLocal?: boolean;
  name?: string;
  isSpeaker?: boolean;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ track, isLocal = false, name = '', isSpeaker = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !track) return;

    const stream = new MediaStream([track]);
    videoElement.srcObject = stream;

    return () => {
      videoElement.srcObject = null;
    };
  }, [track]);

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      backgroundColor: '#2a2a4e',
      borderRadius: '8px',
      overflow: 'hidden',
      boxShadow: isSpeaker 
        ? '0 0 0 4px #fbbf24, 0 0 20px rgba(251, 191, 36, 0.5)' 
        : '0 4px 6px rgba(0, 0, 0, 0.3)',
      transition: 'box-shadow 0.3s ease'
    }}>
      <video
        ref={videoRef}
        autoPlay
        muted={isLocal}
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }}
      />
      {isSpeaker && (
        <div style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          backgroundColor: '#fbbf24',
          padding: '4px 12px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: 600,
          color: '#1f2937',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          animation: 'pulse 2s infinite'
        }}>
          <span>🎤</span>
          <span>演讲者</span>
        </div>
      )}
      <div style={{
        position: 'absolute',
        bottom: '8px',
        left: '8px',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        padding: '4px 12px',
        borderRadius: '4px',
        fontSize: '14px',
        color: '#fff'
      }}>
        {name || (isLocal ? '我' : '参与者')}
        {isLocal && <span style={{ marginLeft: '8px', color: '#4ade80' }}>●</span>}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
};

export default VideoPlayer;
