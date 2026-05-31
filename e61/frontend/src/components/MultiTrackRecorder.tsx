import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RoomManager } from './RoomManager';
import { MultiSpeakerSubtitles } from './MultiSpeakerSubtitles';
import { BookmarkPanel } from './BookmarkPanel';
import { RecordingResult } from './RecordingResult';
import { Participant, Subtitle, Bookmark } from '../types';

interface MultiTrackRecorderProps {
  ws: WebSocket | null;
}

export const MultiTrackRecorder: React.FC<MultiTrackRecorderProps> = ({ ws }) => {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [recordingResult, setRecordingResult] = useState<any>(null);
  const [myColor, setMyColor] = useState('#6B7280');

  const localStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const durationIntervalRef = useRef<number | null>(null);

  const handleWebSocketMessage = useCallback((data: any) => {
    switch (data.type) {
      case 'room-created':
        setRoomId(data.data.roomId);
        break;
      case 'joined-room':
        setRoomId(data.data.roomId);
        setParticipantId(data.data.participantId);
        setParticipantName(data.data.participantName);
        setParticipants(data.data.participants);
        setMyColor(data.data.color);
        break;
      case 'participant-joined':
        setParticipants(prev => [...prev, data.data]);
        break;
      case 'participant-left':
        setParticipants(prev =>
          prev.map(p => p.id === data.data.participantId ? { ...p, connected: false } : p)
        );
        break;
      case 'recording-started':
        setIsRecording(true);
        setRecordingStartTime(Date.now());
        break;
      case 'subtitle-update':
        setSubtitles(prev => [...prev, data.data]);
        break;
      case 'bookmark-added':
        setBookmarks(prev => [...prev, data.data]);
        break;
      case 'recording-completed':
        setRecordingResult(data.data);
        setIsRecording(false);
        break;
      case 'recording-error':
        alert('录制处理失败');
        setIsRecording(false);
        break;
    }
  }, []);

  useEffect(() => {
    if (!ws) return;

    const messageHandler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (e) {
        console.error('Parse error:', e);
      }
    };

    ws.addEventListener('message', messageHandler);
    return () => ws.removeEventListener('message', messageHandler);
  }, [ws, handleWebSocketMessage]);

  useEffect(() => {
    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        localStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('无法访问摄像头/麦克风，请检查权限设置');
      }
    };
    initMedia();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const createRoom = (maxParticipants: number) => {
    if (ws && participantName.trim()) {
      ws.send(JSON.stringify({
        type: 'create-room',
        data: { maxParticipants }
      }));
    }
  };

  const joinRoom = (roomIdToJoin: string, name: string) => {
    if (ws) {
      ws.send(JSON.stringify({
        type: 'join-room',
        data: { roomId: roomIdToJoin, participantName: name }
      }));
    }
  };

  const startRecording = () => {
    if (!ws || !roomId) return;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    const source = audioContext.createMediaStreamSource(localStreamRef.current!);

    source.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    scriptProcessorRef.current = scriptProcessor;

    scriptProcessor.onaudioprocess = (e) => {
      if (!isRecording || !ws || !roomId || !participantId) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const base64 = btoa(String.fromCharCode(...new Uint8Array(inputData.buffer)));
      const timestamp = (Date.now() - recordingStartTime) / 1000;

      ws.send(JSON.stringify({
        type: 'audio-chunk',
        roomId,
        participantId,
        data: { audio: base64, timestamp }
      }));
    };

    const videoStream = localStreamRef.current;
    if (videoStream) {
      const videoRecorder = new MediaRecorder(videoStream, {
        mimeType: 'video/webm;codecs=vp9'
      });

      videoRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws) {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = btoa(String.fromCharCode(...new Uint8Array(reader.result as ArrayBuffer)));
            const timestamp = (Date.now() - recordingStartTime) / 1000;

            ws.send(JSON.stringify({
              type: 'video-chunk',
              roomId,
              participantId,
              data: { video: base64, timestamp }
            }));
          };
          reader.readAsArrayBuffer(event.data);
        }
      };

      videoRecorder.start(100);
    }

    ws.send(JSON.stringify({
      type: 'start-recording',
      roomId
    }));

    durationIntervalRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - recordingStartTime) / 1000;
      setDuration(elapsed);
    }, 100);
  };

  const stopRecording = () => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }
    if (ws && roomId) {
      ws.send(JSON.stringify({
        type: 'stop-recording',
        roomId
      }));
    }
  };

  const addBookmark = (label: string) => {
    const time = duration;
    if (ws && roomId) {
      ws.send(JSON.stringify({
        type: 'add-bookmark',
        roomId,
        data: { bookmark: { time, label } }
      }));
    }
  };

  const isConnected = !!roomId && !!participantId;

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-6 text-center">
          多人访谈录制系统
        </h1>

        {!isConnected ? (
          <div className="max-w-md mx-auto">
            <RoomManager
              onJoinRoom={joinRoom}
              onCreateRoom={createRoom}
              isConnected={isConnected}
              participants={participants}
              isRecording={isRecording}
            />
          </div>
        ) : (
          <>
            {roomId && (
              <div className="mb-4 p-3 bg-gray-800 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="text-gray-300">房间 ID:</span>
                  <code className="px-3 py-1 bg-gray-700 text-yellow-400 rounded font-mono">
                    {roomId}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(roomId)}
                    className="text-blue-400 hover:text-blue-300 text-sm"
                  >
                    复制
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: myColor }}
                  />
                  <span className="text-gray-300">{participantName}</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-gray-800 rounded-lg overflow-hidden">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full aspect-video object-cover"
                  />
                  {isRecording && (
                    <div className="p-4 border-t border-gray-700 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-white font-mono text-lg">
                          {Math.floor(duration / 60).toString().padStart(2, '0')}:
                          {Math.floor(duration % 60).toString().padStart(2, '0')}.
                          {Math.floor((duration % 1) * 100).toString().padStart(2, '0')}
                        </span>
                      </div>
                      <button
                        onClick={stopRecording}
                        className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                      >
                        停止录制
                      </button>
                    </div>
                  )}
                </div>

                {!isRecording && (
                  <button
                    onClick={startRecording}
                    disabled={!localStreamRef.current}
                    className="w-full py-4 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                  >
                    <span className="w-4 h-4 bg-white rounded-full" />
                    开始录制
                  </button>
                )}

                <MultiSpeakerSubtitles
                  subtitles={subtitles}
                  currentTime={duration}
                />
              </div>

              <div className="space-y-6">
                <RoomManager
                  onJoinRoom={joinRoom}
                  onCreateRoom={createRoom}
                  isConnected={isConnected}
                  participants={participants}
                  isRecording={isRecording}
                />
                <BookmarkPanel
                  bookmarks={bookmarks}
                  onAddBookmark={addBookmark}
                  disabled={!isRecording}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {recordingResult && (
        <RecordingResult
          videoUrl={recordingResult.videoUrl}
          subtitlesUrl={recordingResult.subtitlesUrl}
          bookmarks={recordingResult.bookmarks}
          subtitles={recordingResult.subtitles}
          onClose={() => setRecordingResult(null)}
        />
      )}
    </div>
  );
};
