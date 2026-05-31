import React, { useEffect } from 'react';
import { MultiTrackRecorder } from './components/MultiTrackRecorder';
import { useMultiTrackWebSocket } from './hooks/useMultiTrackWebSocket';

const App: React.FC = () => {
  const { ws, isConnected, connect } = useMultiTrackWebSocket();

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="min-h-screen bg-gray-900">
      {!isConnected ? (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white">正在连接服务器...</p>
          </div>
        </div>
      ) : (
        <MultiTrackRecorder ws={ws} />
      )}
    </div>
  );
};

export default App;
