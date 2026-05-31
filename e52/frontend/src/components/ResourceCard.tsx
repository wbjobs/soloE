import { Link } from 'react-router-dom';
import { Resource } from '../types';

interface ResourceCardProps {
  resource: Resource;
}

export default function ResourceCard({ resource }: ResourceCardProps) {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  return (
    <Link to={`/resource/${resource.id}`}>
      <div className="glass p-6 hover:scale-105 transition-all duration-300 cursor-pointer group">
        <div className="flex items-start justify-between mb-4">
          <div className="w-12 h-12 bg-gradient-to-br from-primary/20 to-success/20 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="text-xs text-gray-400 bg-white/5 px-2 py-1 rounded-full">
            {resource.chunkCount} 分片
          </span>
        </div>

        <h3 className="font-semibold text-lg mb-2 truncate group-hover:text-primary transition-colors">
          {resource.name}
        </h3>

        <p className="text-gray-400 text-sm mb-4">
          {formatSize(resource.size)}
        </p>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-4">
            <span className="flex items-center text-success">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
              </svg>
              {resource.seeders} 做种
            </span>
            <span className="text-gray-400">
              {resource.downloadCount} 下载
            </span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: '100%' }} />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            InfoHash: {resource.infoHash.substring(0, 16)}...
          </p>
        </div>
      </div>
    </Link>
  );
}
