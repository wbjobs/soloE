import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getResource, getChunks, getChunkAvailability, triggerReplication, triggerProbe } from '../services/api';
import { Resource as ResourceType, Chunk, ChunkAvailability } from '../types';
import ChunkPeerInfo from '../components/ChunkPeerInfo';

export default function ResourceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [resource, setResource] = useState<ResourceType | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [availability, setAvailability] = useState<ChunkAvailability[]>([]);
  const [minReplicas, setMinReplicas] = useState(3);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (id) {
      loadResource(id);
    }
  }, [id]);

  const loadResource = async (resourceId: string) => {
    try {
      const data = await getResource(resourceId);
      setResource(data);

      const chunksData = await getChunks(resourceId);
      setChunks(chunksData.chunks || []);

      const availData = await getChunkAvailability(resourceId);
      setAvailability(availData.chunks || []);
      setMinReplicas(availData.minReplicas || 3);
    } catch (error) {
      console.error('Failed to load resource:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyMagnetLink = () => {
    if (resource) {
      navigator.clipboard.writeText(resource.magnetLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleTriggerReplication = async (chunkHash: string) => {
    if (resource) {
      await triggerReplication(chunkHash, resource.id);
      loadResource(resource.id);
    }
  };

  const handleTriggerProbe = async () => {
    if (resource) {
      setProbing(true);
      await triggerProbe(resource.infoHash, resource.id);
      setTimeout(() => setProbing(false), 2000);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const getReplicaStatusColor = (count: number) => {
    if (count >= minReplicas) return 'text-success';
    if (count >= 1) return 'text-warning';
    return 'text-red-500';
  };

  const getReplicaBgColor = (count: number) => {
    if (count >= minReplicas) return 'bg-success/20 border-success/30';
    if (count >= 1) return 'bg-warning/20 border-warning/30';
    return 'bg-red-500/20 border-red-500/30';
  };

  if (loading) {
    return (
      <div className="text-center py-20 text-gray-400">
        <svg className="animate-spin w-12 h-12 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        加载中...
      </div>
    );
  }

  if (!resource) {
    return (
      <div className="text-center py-20 glass">
        <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-gray-400 mb-4">资源不存在</p>
        <button onClick={() => navigate('/')} className="btn-primary">
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button
        onClick={() => navigate('/')}
        className="flex items-center text-gray-400 hover:text-white transition-colors"
      >
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        返回列表
      </button>

      <div className="glass p-8">
        <div className="flex items-start gap-6">
          <div className="w-24 h-24 bg-gradient-to-br from-primary/20 to-success/20 rounded-2xl flex items-center justify-center flex-shrink-0">
            <svg className="w-12 h-12 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">{resource.name}</h1>
            <p className="text-gray-400 mb-4">
              {formatSize(resource.size)} · {resource.chunkCount} 分片 · SHA-1 校验
            </p>

            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-white/5 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-success">{resource.seeders}</div>
                <div className="text-sm text-gray-400">做种节点</div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-primary">{resource.downloadCount}</div>
                <div className="text-sm text-gray-400">下载次数</div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-warning">{resource.hotScore.toFixed(1)}</div>
                <div className="text-sm text-gray-400">热度评分</div>
              </div>
              <div className="bg-white/5 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">{resource.chunkSize / 1024}KB</div>
                <div className="text-sm text-gray-400">分片大小</div>
              </div>
            </div>

            <div className="flex gap-4">
              <button className="btn-primary flex-1">开始下载</button>
              <button
                onClick={copyMagnetLink}
                className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors flex items-center"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {copied ? '已复制' : '复制磁力链接'}
              </button>
              <button
                onClick={handleTriggerProbe}
                disabled={probing}
                className="px-6 py-2 bg-warning/20 hover:bg-warning/30 text-warning rounded-lg transition-colors flex items-center disabled:opacity-50"
              >
                <svg className={`w-5 h-5 mr-2 ${probing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {probing ? '探测中...' : 'DHT探测'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="glass p-6">
        <h3 className="text-lg font-semibold mb-4">InfoHash</h3>
        <code className="block bg-black/30 p-4 rounded-lg text-sm text-gray-300 font-mono break-all">
          {resource.infoHash}
        </code>
      </div>

      <div className="glass p-6">
        <ChunkPeerInfo chunks={availability} resourceId={resource.id} />
      </div>

      <div className="glass p-6">
        <h3 className="text-lg font-semibold mb-4">分片列表</h3>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {chunks.map((chunk, index) => {
            const avail = availability.find(a => a.chunkHash === chunk.hash);
            const replicaCount = avail?.replicaCount || 0;
            const isHot = avail?.isHot || false;
            return (
              <div
                key={index}
                className="flex items-center gap-4 p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${getReplicaBgColor(replicaCount)}`}>
                  <span className={`text-xs font-bold ${getReplicaStatusColor(replicaCount)}`}>
                    {replicaCount}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">分片 #{index + 1}</p>
                    {isHot && (
                      <span className="px-2 py-0.5 bg-warning/20 text-warning text-xs rounded-full">
                        热门
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate font-mono">{chunk.hash}</p>
                </div>
                <span className="text-sm text-gray-400 flex-shrink-0">
                  {formatSize(chunk.size)}
                </span>
                {replicaCount < minReplicas && (
                  <button
                    onClick={() => handleTriggerReplication(chunk.hash)}
                    className="px-3 py-1 bg-primary/20 hover:bg-primary/30 text-primary text-xs rounded-lg transition-colors flex-shrink-0"
                  >
                    复制
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass p-6">
        <h3 className="text-lg font-semibold mb-4">技术信息</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">资源 ID</span>
            <span className="font-mono">{resource.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">创建时间</span>
            <span>{new Date(resource.createdAt).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">分片总数</span>
            <span>{resource.chunkCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">哈希算法</span>
            <span className="text-primary">SHA-1</span>
          </div>
        </div>
      </div>
    </div>
  );
}
