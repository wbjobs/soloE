import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import ResourceCard from '../components/ResourceCard';
import BandwidthPanel from '../components/BandwidthPanel';
import PeerGeoMap from '../components/PeerGeoMap';
import { Resource, NetworkStats } from '../types';
import { getResources, getNetworkStats } from '../services/api';

export default function Home() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadResources();
    loadNetworkStats();
    const interval = setInterval(loadNetworkStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadResources = async () => {
    try {
      const data = await getResources();
      setResources(data);
    } catch (error) {
      console.error('Failed to load resources:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadNetworkStats = async () => {
    try {
      const stats = await getNetworkStats();
      setNetworkStats(stats);
    } catch (error) {
      console.error('Failed to load network stats:', error);
    }
  };

  const filteredResources = resources.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.infoHash.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="text-center py-12">
        <h1 className="text-5xl font-bold mb-4">
          <span className="bg-gradient-to-r from-primary via-success to-primary bg-clip-text text-transparent">
            P2P CDN 资源共享平台
          </span>
        </h1>
        <p className="text-gray-400 text-xl max-w-2xl mx-auto">
          基于 WebTorrent 协议的去中心化内容分发网络，
          利用用户闲置带宽，实现高效的资源共享
        </p>
      </div>

      {networkStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="glass p-4 text-center">
            <div className="text-3xl font-bold text-primary mb-1">{networkStats.nodeCount}</div>
            <div className="text-sm text-gray-400">在线节点</div>
          </div>
          <div className="glass p-4 text-center">
            <div className="text-3xl font-bold text-success mb-1">{networkStats.totalChunksTracked}</div>
            <div className="text-sm text-gray-400">分片总数</div>
          </div>
          <div className="glass p-4 text-center">
            <div className="text-3xl font-bold text-red-400 mb-1">{networkStats.lowAvailabilityChunks}</div>
            <div className="text-sm text-gray-400">低可用分片</div>
          </div>
          <div className="glass p-4 text-center">
            <div className="text-3xl font-bold text-warning mb-1">{networkStats.hotChunks}</div>
            <div className="text-sm text-gray-400">热门分片</div>
          </div>
          <div className="glass p-4 text-center col-span-2 md:col-span-1">
            <div className="text-3xl font-bold text-blue-400 mb-1">{networkStats.activeProbes}</div>
            <div className="text-sm text-gray-400">正在探测</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BandwidthPanel />
        <PeerGeoMap />
      </div>

      <div className="glass p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <input
            type="text"
            placeholder="搜索资源名称或 InfoHash..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-primary transition-colors"
          />
          <Link to="/upload" className="btn-primary text-center">
            上传新文件
          </Link>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">热门资源</h2>
          <span className="text-gray-400">
            共 {filteredResources.length} 个资源
          </span>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">
            <svg className="animate-spin w-8 h-8 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            加载中...
          </div>
        ) : filteredResources.length === 0 ? (
          <div className="text-center py-12 glass">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-gray-400">暂无资源，上传第一个文件吧！</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredResources.map(resource => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
