import React, { useState, useEffect } from 'react';
import VideoPlayer from './VideoPlayer';
import BitrateControl from './BitrateControl';
import { WebRtcClient, SpeakerInfo } from '../services/WebRtcClient';
import { Participant, QualityLevel, NetworkStats } from '../types';

interface ConferenceRoomProps {
  roomId: string;
  clientName: string;
  onLeave: () => void;
}

const ConferenceRoom: React.FC<ConferenceRoomProps> = ({ roomId, clientName, onLeave }) => {
  const [webrtcClient, setWebrtcClient] = useState<WebRtcClient | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>('medium');
  const [networkStats, setNetworkStats] = useState<NetworkStats>({
    rtt: 0,
    packetLoss: 0,
    bitrate: 0
  });
  const [isJoined, setIsJoined] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [speakerInfo, setSpeakerInfo] = useState<SpeakerInfo>({
    speakerId: null,
    speakerName: null,
    isSpeakerMode: false
  });

  useEffect(() => {
    const client = new WebRtcClient();
    setWebrtcClient(client);

    client.setOnParticipantsChange((newParticipants) => {
      setParticipants(newParticipants);
    });

    client.setOnNetworkStats((stats) => {
      setNetworkStats(stats);
    });

    client.setOnSpeakerChanged((speaker) => {
      setSpeakerInfo(speaker);
    });

    return () => {
      client.leaveRoom();
    };
  }, []);

  useEffect(() => {
    if (webrtcClient) {
      joinRoom();
    }
  }, [webrtcClient]);

  const joinRoom = async () => {
    if (!webrtcClient) return;

    const success = await webrtcClient.joinRoom(roomId, clientName);
    if (success) {
      const stream = await webrtcClient.startLocalVideo();
      setLocalStream(stream);
      setIsJoined(true);
    }
    setIsLoading(false);
  };

  const handleQualityLevelChange = async (level: QualityLevel) => {
    if (webrtcClient) {
      await webrtcClient.setQualityLevel(level);
      setQualityLevel(level);
    }
  };

  const toggleAudio = () => {
    if (webrtcClient) {
      const newState = !isAudioEnabled;
      webrtcClient.toggleAudio(newState);
      setIsAudioEnabled(newState);
    }
  };

  const toggleVideo = () => {
    if (webrtcClient) {
      const newState = !isVideoEnabled;
      webrtcClient.toggleVideo(newState);
      setIsVideoEnabled(newState);
    }
  };

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#1a1a2e'
      }}>
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid #fff',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px'
          }} />
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
          <div>正在加入会议...</div>
        </div>
      </div>
    );
  }

  if (!isJoined) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#1a1a2e'
      }}>
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>❌</div>
          <div style={{ marginBottom: '20px' }}>加入会议失败</div>
          <button
            onClick={onLeave}
            style={{
              padding: '12px 24px',
              backgroundColor: '#0f3460',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  const allVideos = [
    { 
      isLocal: true, 
      track: localStream?.getVideoTracks()[0] || null, 
      name: clientName,
      isSpeaker: speakerInfo.speakerId === webrtcClient?.getSocketId()
    },
    ...participants.map(p => ({
      isLocal: false,
      track: p.videoTrack || null,
      name: p.name || '参与者',
      isSpeaker: speakerInfo.speakerId === p.id
    }))
  ];

  const getGridClass = () => {
    const count = allVideos.length;
    if (count <= 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    if (count <= 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
    if (count <= 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: '#1a1a2e',
      padding: '20px'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#fff' }}>
            会议室: {roomId}
          </h1>
          <p style={{ margin: '4px 0 0 0', color: '#888', fontSize: '14px' }}>
            在线人数: {allVideos.length} / 4
          </p>
        </div>
        <button
          onClick={onLeave}
          style={{
            padding: '10px 20px',
            backgroundColor: '#e94560',
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '14px',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          离开会议
        </button>
      </div>

      <div style={{
        display: 'flex',
        flex: 1,
        gap: '20px'
      }}>
        <div style={{
          flex: 1,
          display: 'grid',
          gap: '16px',
          ...getGridClass()
        }}>
          {allVideos.map((video, index) => (
            <VideoPlayer
              key={index}
              track={video.track}
              isLocal={video.isLocal}
              name={video.name}
              isSpeaker={video.isSpeaker}
            />
          ))}
        </div>

        <div style={{ width: '300px' }}>
          {speakerInfo.isSpeakerMode && speakerInfo.speakerName && (
            <div style={{
              backgroundColor: '#16213e',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '16px',
              border: '2px solid #fbbf24',
              boxShadow: '0 0 10px rgba(251, 191, 36, 0.3)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px'
              }}>
                <span style={{ fontSize: '20px' }}>🎤</span>
                <span style={{ color: '#fbbf24', fontWeight: 600, fontSize: '14px' }}>
                  演讲者模式
                </span>
              </div>
              <div style={{ color: '#fff', fontSize: '16px', fontWeight: 500 }}>
                当前演讲者: {speakerInfo.speakerName}
              </div>
              <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>
                自动接收高质量视频流
              </div>
            </div>
          )}
          
          <div style={{
            backgroundColor: '#16213e',
            borderRadius: '12px',
            padding: '20px'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#fff' }}>
              控制
            </h3>
            <div style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '20px'
            }}>
              <button
                onClick={toggleAudio}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: isAudioEnabled ? '#0f3460' : '#e94560',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                {isAudioEnabled ? '🔊 音频' : '🔇 静音'}
              </button>
              <button
                onClick={toggleVideo}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: isVideoEnabled ? '#0f3460' : '#e94560',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                {isVideoEnabled ? '📹 视频' : '📷 关闭'}
              </button>
            </div>
          </div>

          <BitrateControl
            currentLevel={qualityLevel}
            onLevelChange={handleQualityLevelChange}
            networkStats={networkStats}
          />
        </div>
      </div>
    </div>
  );
};

export default ConferenceRoom;
