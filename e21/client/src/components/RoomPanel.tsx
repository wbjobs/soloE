import { useState } from 'react';
import { StatusIndicator } from './StatusIndicator';
import { ConnectionStatus } from '../types';

interface RoomPanelProps {
  roomId: string;
  isInRoom: boolean;
  socketStatus: ConnectionStatus;
  peerStatus: ConnectionStatus;
  connectionMode: 'p2p' | 'relay' | 'connecting';
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onDisconnect: () => void;
}

export function RoomPanel({
  roomId,
  isInRoom,
  socketStatus,
  peerStatus,
  connectionMode,
  onCreateRoom,
  onJoinRoom,
  onDisconnect,
}: RoomPanelProps) {
  const [joinRoomId, setJoinRoomId] = useState('');

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
  };

  if (isInRoom) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-800">房间信息</h2>
          <button
            onClick={onDisconnect}
            className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            断开连接
          </button>
        </div>

        <div className="space-y-3 mb-6">
          <StatusIndicator status={socketStatus} label="服务器" />
          <StatusIndicator status={peerStatus} label="对等端" />
          {peerStatus === 'connected' && (
            <div className="mt-2 p-2 rounded-lg bg-gray-50">
              <span className="text-sm text-gray-600">传输模式: </span>
              <span className={`font-semibold ${connectionMode === 'p2p' ? 'text-success' : 'text-warning'}`}>
                {connectionMode === 'p2p' ? '🔗 P2P 直连 (高速)' : '📡 服务器中继 (兼容)'}
              </span>
            </div>
          )}
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-sm text-gray-500 mb-2">房间号</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-2xl font-mono font-bold text-primary tracking-wider">
              {roomId}
            </code>
            <button
              onClick={copyRoomId}
              className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              复制
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            将此房间号分享给对方以建立连接
          </p>
        </div>

        {peerStatus === 'connected' ? (
          <div className="mt-4 p-4 bg-success/10 border border-success/30 rounded-xl">
            <p className="text-success font-medium flex items-center gap-2">
              <span className="text-xl">🎉</span>
              P2P 连接已建立，可以开始传输文件！
            </p>
          </div>
        ) : (
          <div className="mt-4 p-4 bg-warning/10 border border-warning/30 rounded-xl">
            <p className="text-warning font-medium flex items-center gap-2">
              <span className="text-xl animate-spin-slow">⏳</span>
              等待对方加入房间...
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">
        P2P 文件传输
      </h2>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-700 flex items-center gap-2">
            <span className="text-2xl">🏠</span>
            创建房间
          </h3>
          <p className="text-sm text-gray-500">
            创建一个新房间，分享房间号给对方
          </p>
          <button
            onClick={onCreateRoom}
            className="w-full py-3 px-4 bg-primary text-white font-medium rounded-xl hover:bg-primary/90 transition-all duration-300 transform hover:scale-105 shadow-lg shadow-primary/30"
          >
            创建新房间
          </button>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold text-gray-700 flex items-center gap-2">
            <span className="text-2xl">🔗</span>
            加入房间
          </h3>
          <p className="text-sm text-gray-500">
            输入对方分享的房间号加入
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              placeholder="输入房间号"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary font-mono text-lg uppercase"
              maxLength={6}
            />
            <button
              onClick={() => onJoinRoom(joinRoomId)}
              className="px-6 py-3 bg-success text-white font-medium rounded-xl hover:bg-success/90 transition-all duration-300 transform hover:scale-105 shadow-lg shadow-success/30"
            >
              加入
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
        <h4 className="font-medium text-blue-800 mb-2">💡 使用说明</h4>
        <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
          <li>一方点击"创建新房间"，生成房间号</li>
          <li>将房间号分享给另一方</li>
          <li>另一方输入房间号并点击"加入"</li>
          <li>等待 P2P 连接建立后即可传输文件</li>
        </ol>
      </div>
    </div>
  );
}
