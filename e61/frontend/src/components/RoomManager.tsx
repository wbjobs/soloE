import React, { useState } from 'react';
import { Participant } from '../types';

interface RoomManagerProps {
  onJoinRoom: (roomId: string, participantName: string) => void;
  onCreateRoom: (maxParticipants: number) => void;
  isConnected: boolean;
  participants: Participant[];
  isRecording: boolean;
}

export const RoomManager: React.FC<RoomManagerProps> = ({
  onJoinRoom,
  onCreateRoom,
  isConnected,
  participants,
  isRecording
}) => {
  const [mode, setMode] = useState<'create' | 'join' | null>(null);
  const [roomId, setRoomId] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(4);

  const handleCreate = () => {
    if (participantName.trim()) {
      onCreateRoom(maxParticipants);
    }
  };

  const handleJoin = () => {
    if (roomId.trim() && participantName.trim()) {
      onJoinRoom(roomId, participantName);
    }
  };

  if (isConnected) {
    return (
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-white font-semibold mb-3">会议室成员</h3>
        <div className="space-y-2">
          {participants.map((participant) => (
            <div
              key={participant.id}
              className="flex items-center gap-3 p-2 bg-gray-700 rounded"
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: participant.color }}
              />
              <span className="text-gray-200">{participant.name}</span>
              <span className={`ml-auto text-xs px-2 py-1 rounded ${
                participant.connected ? 'bg-green-600 text-white' : 'bg-gray-500 text-gray-300'
              }`}>
                {participant.connected ? '在线' : '离线'}
              </span>
            </div>
          ))}
        </div>
        {isRecording && (
          <div className="mt-4 p-3 bg-red-900 bg-opacity-50 rounded-lg border border-red-500">
            <div className="flex items-center gap-2 text-red-400">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="font-medium">录制中...</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h2 className="text-xl font-bold text-white mb-6 text-center">多人访谈录制</h2>

      {!mode ? (
        <div className="space-y-4">
          <button
            onClick={() => setMode('create')}
            className="w-full py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            创建新房间
          </button>
          <button
            onClick={() => setMode('join')}
            className="w-full py-4 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
          >
            加入房间
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-gray-300 mb-2">你的名字</label>
            <input
              type="text"
              value={participantName}
              onChange={(e) => setParticipantName(e.target.value)}
              placeholder="输入你的名字..."
              className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          {mode === 'create' ? (
            <>
              <div>
                <label className="block text-gray-300 mb-2">最大参与人数</label>
                <select
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(Number(e.target.value))}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500"
                >
                  <option value={2}>2人</option>
                  <option value={3}>3人</option>
                  <option value={4}>4人</option>
                </select>
              </div>
              <button
                onClick={handleCreate}
                disabled={!participantName.trim()}
                className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                创建房间
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="block text-gray-300 mb-2">房间 ID</label>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="输入房间 ID..."
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                onClick={handleJoin}
                disabled={!roomId.trim() || !participantName.trim()}
                className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                加入房间
              </button>
            </>
          )}

          <button
            onClick={() => setMode(null)}
            className="w-full py-2 text-gray-400 hover:text-white transition-colors"
          >
            返回
          </button>
        </div>
      )}
    </div>
  );
};
