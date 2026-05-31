import { useState, useEffect } from 'react';
import { parseMagnetLink, getResources, announceToTracker } from '../services/api';
import { P2PDownloader } from '../services/p2p';
import { Resource, Peer } from '../types';

export default function Download() {
  const [magnetInput, setMagnetInput] = useState('');
  const [resource, setResource] = useState<Resource | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadedChunks, setDownloadedChunks] = useState<number>(0);
  const [speed, setSpeed] = useState(0);
  const [downloader, setDownloader] = useState<P2PDownloader | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);

  useEffect(() => {
    loadResources();
  }, []);

  const loadResources = async () => {
    try {
      const data = await getResources();
      setResources(data);
    } catch (error) {
      console.error('Failed to load resources:', error);
    }
  };

  const handleParseMagnet = async () => {
    const infoHash = parseMagnetLink(magnetInput);
    if (!infoHash) {
      alert('无效的磁力链接');
      return;
    }

    const foundResource = resources.find(r => r.infoHash === infoHash);
    if (foundResource) {
      setResource(foundResource);
      const result = await announceToTracker(infoHash, 'test-peer-id');
      setPeers(result.peers);
    } else {
      alert('未找到对应的资源');
    }
  };

  const startDownload = async () => {
    if (!resource) return;

    setDownloading(true);
    setProgress(0);
    setDownloadedChunks(0);

    const newDownloader = new P2PDownloader(
      resource,
      (p, chunks, spd) => {
        setProgress(p);
        setDownloadedChunks(chunks);
        setSpeed(spd);
      },
      () => {
        setDownloading(false);
      }
    );

    setDownloader(newDownloader);
    await newDownloader.start();
  };

  const formatSpeed = (bytesPerSecond: number) => {
    if (bytesPerSecond < 1024) return bytesPerSecond.toFixed(2) + ' B/s';
    if (bytesPerSecond < 1024 * 1024) return (bytesPerSecond / 1024).toFixed(2) + ' KB/s';
    return (bytesPerSecond / (1024 * 1024)).toFixed(2) + ' MB/s';
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">下载资源</h1>
        <p className="text-gray-400">
          输入磁力链接，通过 P2P 网络下载文件
        </p>
      </div>

      <div className="glass p-6">
        <div className="flex flex-col md:flex-row gap-4">
          <input
            type="text"
            placeholder="输入磁力链接 (magnet:?xt=urn:btih:..."
            value={magnetInput}
            onChange={(e) => setMagnetInput(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-primary transition-colors font-mono text-sm"
          />
          <button
            onClick={handleParseMagnet}
            className="btn-primary"
            disabled={!magnetInput || downloading}
          >
            解析链接
          </button>
        </div>
      </div>

      {resource && (
        <div className="glass p-6 space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-success/20 rounded-xl flex items-center justify-center">
              <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold mb-1">{resource.name}</h3>
              <p className="text-gray-400 text-sm mb-3">
                {(resource.size / 1024 / 1024).toFixed(2)} MB · {resource.chunkCount} 分片
              </p>
              <div className="flex gap-4 text-sm">
                <span className="text-success">{resource.seeders} 做种</span>
                <span className="text-primary">{peers.length} 节点</span>
                <span className="text-gray-400">{resource.downloadCount} 下载</span>
              </div>
            </div>
          </div>

          {downloading ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">下载进度</span>
                <span className="font-medium">{progress.toFixed(1)}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">
                  已下载 {downloadedChunks}/{resource.chunkCount} 分片
                </span>
                <span className="text-primary">{formatSpeed(speed)}</span>
              </div>

              <div className="grid grid-cols-8 gap-1">
                {Array.from({ length: resource.chunkCount }, (_, i) => (
                  <div
                    key={i}
                    className={`h-2 rounded ${i < downloadedChunks ? 'bg-success' : 'bg-gray-700'}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <button onClick={startDownload} className="btn-primary w-full">
              开始下载
            </button>
          )}
        </div>
      )}

      <div className="glass p-6">
        <h3 className="text-lg font-semibold mb-4">或从现有资源中选择</h3>
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {resources.map(r => (
            <div
              key={r.id}
              onClick={() => {
                setResource(r);
                setMagnetInput(r.magnetLink);
              }}
              className="flex items-center gap-4 p-3 bg-white/5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors"
            >
              <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-medium truncate">{r.name}</p>
                <p className="text-sm text-gray-400">{(r.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <span className="text-success text-sm">{r.seeders} 做种</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
