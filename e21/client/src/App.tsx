import { useEffect } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { RoomPanel } from './components/RoomPanel';
import { FileDropZone } from './components/FileDropZone';
import { FileList } from './components/FileList';

function App() {
  const {
    socketStatus,
    peerStatus,
    roomId,
    isInRoom,
    files,
    error,
    connectionMode,
    createRoom,
    joinRoom,
    sendFile,
    disconnect,
    setError,
  } = useWebRTC();

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [error, setError]);

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white text-center mb-8 drop-shadow-lg">
          🔗 P2P 文件直传
        </h1>

        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-300 text-red-700 rounded-xl text-center">
            {error}
          </div>
        )}

        <div className="space-y-6">
          <RoomPanel
            roomId={roomId}
            isInRoom={isInRoom}
            socketStatus={socketStatus}
            peerStatus={peerStatus}
            connectionMode={connectionMode}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            onDisconnect={disconnect}
          />

          {isInRoom && (
            <div className="bg-white rounded-2xl shadow-xl p-6 space-y-6">
              <FileDropZone
                onFileSelect={sendFile}
                disabled={peerStatus !== 'connected'}
              />

              <FileList files={files} />
            </div>
          )}
        </div>

        <footer className="mt-8 text-center text-white/70 text-sm">
          <p>基于 WebRTC 技术实现，支持 P2P 直连和服务器中继双重模式</p>
          <p className="mt-1">优先直连传输，复杂网络环境自动降级中继</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
