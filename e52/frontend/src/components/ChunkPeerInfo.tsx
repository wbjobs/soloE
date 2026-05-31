import { useState } from 'react';
import { ChunkAvailability } from '../types';
import { triggerReplication } from '../services/api';

interface ChunkPeerInfoProps {
  chunks: ChunkAvailability[];
  resourceId: string;
}

export default function ChunkPeerInfo({ chunks, resourceId }: ChunkPeerInfoProps) {
  const [selectedChunk, setSelectedChunk] = useState<ChunkAvailability | null>(null);

  const getChunkColor = (replicaCount: number): string => {
    if (replicaCount >= 3) return 'bg-green-500';
    if (replicaCount >= 1) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const handleReplicate = async (chunkHash: string) => {
    try {
      await triggerReplication(chunkHash, resourceId);
    } catch (error) {
      console.error('Failed to trigger replication:', error);
    }
  };

  const sortedChunks = [...chunks].sort((a, b) => a.replicaCount - b.replicaCount);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-700">分片副本状态</h3>
      </div>

      <div className="grid grid-cols-8 gap-1">
        {sortedChunks.slice(0, 64).map((chunk, index) => (
          <button
            key={chunk.chunkHash}
            onClick={() => setSelectedChunk(selectedChunk?.chunkHash === chunk.chunkHash ? null : chunk)}
            className={`aspect-square rounded ${getChunkColor(chunk.replicaCount)} hover:opacity-80 transition-all duration-200 flex items-center justify-center text-white text-xs font-bold relative group ${selectedChunk?.chunkHash === chunk.chunkHash ? 'ring-2 ring-blue-400 scale-110' : ''}`}
            title={`分片 ${index + 1}: ${chunk.replicaCount} 个副本`}
          >
            {chunk.replicaCount}
            {chunk.isHot && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full text-[10px] animate-pulse" />
            )}
          </button>
        ))}
      </div>

      <div className="flex justify-center space-x-6 text-xs text-gray-500">
        <span className="flex items-center">
          <span className="w-3 h-3 bg-green-500 rounded mr-1" /> 充足 (≥3)
        </span>
        <span className="flex items-center">
          <span className="w-3 h-3 bg-yellow-500 rounded mr-1" /> 较少 (1-2)
        </span>
        <span className="flex items-center">
          <span className="w-3 h-3 bg-red-500 rounded mr-1" /> 危险 (0)
        </span>
      </div>

      {selectedChunk && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
          <div className="flex justify-between items-start mb-3">
            <h4 className="font-medium text-gray-800">分片详情</h4>
            {selectedChunk.replicaCount < 3 && (
              <button
                onClick={() => handleReplicate(selectedChunk.chunkHash)}
                className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
              >
                复制分片
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">副本数量:</span>
              <span className="ml-2 font-medium">{selectedChunk.replicaCount}</span>
            </div>
            <div>
              <span className="text-gray-500">下载次数:</span>
              <span className="ml-2 font-medium">{selectedChunk.downloadCount || 0}</span>
            </div>
            <div className="col-span-2">
              <span className="text-gray-500">分片哈希:</span>
              <span className="ml-2 font-mono text-xs break-all">
                {selectedChunk.chunkHash}
              </span>
            </div>
            <div>
              <span className="text-gray-500">热门分片:</span>
              <span className="ml-2 font-medium">
                {selectedChunk.isHot ? '🔥 是' : '否'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">优先级得分:</span>
              <span className="ml-2 font-medium">{selectedChunk.priorityScore.toFixed(2)}</span>
            </div>
          </div>

          {selectedChunk.peerIds && selectedChunk.peerIds.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <h5 className="text-sm font-medium text-gray-700 mb-2">提供该分片的节点</h5>
              <div className="flex flex-wrap gap-2">
                {selectedChunk.peerIds.slice(0, 8).map((peerId) => (
                  <span
                    key={peerId}
                    className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full"
                  >
                    {peerId.substring(0, 8)}...
                  </span>
                ))}
                {selectedChunk.peerIds.length > 8 && (
                  <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                    +{selectedChunk.peerIds.length - 8} 更多
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 pt-4 border-t">
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <div className="text-2xl font-bold text-green-600">
            {chunks.filter(c => c.replicaCount >= 3).length}
          </div>
          <div className="text-xs text-green-600">副本充足</div>
        </div>
        <div className="text-center p-3 bg-yellow-50 rounded-lg">
          <div className="text-2xl font-bold text-yellow-600">
            {chunks.filter(c => c.replicaCount >= 1 && c.replicaCount < 3).length}
          </div>
          <div className="text-xs text-yellow-600">副本较少</div>
        </div>
        <div className="text-center p-3 bg-red-50 rounded-lg">
          <div className="text-2xl font-bold text-red-600">
            {chunks.filter(c => c.replicaCount === 0).length}
          </div>
          <div className="text-xs text-red-600">无副本</div>
        </div>
      </div>
    </div>
  );
}
