import { Trash2, Download, Clock, Search } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../store';
import { formatBytes, formatTime, getFileIcon } from '../utils/format';

export function History() {
  const { transfers, removeTransfer } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTransfers = transfers.filter((t) =>
    t.peerDevice.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.files.some((f) => f.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const totalTransferred = transfers
    .filter((t) => t.status === 'completed')
    .reduce((acc, t) => acc + t.totalSize, 0);

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">传输历史</h1>
          <p className="text-dark-300">查看所有历史文件传输记录</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="card p-5">
            <div className="text-3xl font-bold text-primary mb-1">{transfers.length}</div>
            <div className="text-sm text-dark-300">总传输次数</div>
          </div>
          <div className="card p-5">
            <div className="text-3xl font-bold text-secondary mb-1">{formatBytes(totalTransferred)}</div>
            <div className="text-sm text-dark-300">总传输数据</div>
          </div>
          <div className="card p-5">
            <div className="text-3xl font-bold text-warning mb-1">
              {transfers.filter((t) => t.status === 'completed').length}
            </div>
            <div className="text-sm text-dark-300">成功传输</div>
          </div>
        </div>

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-dark-400" />
            <input
              type="text"
              placeholder="搜索传输记录..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-dark-700 border border-dark-600 rounded-xl text-white placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {filteredTransfers.length > 0 ? (
          <div className="space-y-3">
            {filteredTransfers.map((task) => (
              <div
                key={task.id}
                className="card p-4 flex items-center justify-between hover:bg-dark-600/50 transition-colors"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    task.status === 'completed' ? 'bg-secondary/10' :
                    task.status === 'failed' ? 'bg-red-500/10' : 'bg-dark-600'
                  }`}>
                    {task.direction === 'send' ? (
                      <svg className={`w-6 h-6 ${
                        task.status === 'completed' ? 'text-secondary' :
                        task.status === 'failed' ? 'text-red-500' : 'text-dark-300'
                      }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                      </svg>
                    ) : (
                      <Download className={`w-6 h-6 ${
                        task.status === 'completed' ? 'text-secondary' :
                        task.status === 'failed' ? 'text-red-500' : 'text-dark-300'
                      }`} />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white">{task.peerDevice.name}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        task.status === 'completed' ? 'bg-secondary/10 text-secondary' :
                        task.status === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-dark-500 text-dark-300'
                      }`}>
                        {task.status === 'completed' ? '成功' : task.status === 'failed' ? '失败' : task.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-dark-300">
                      <span>{task.files.length} 个文件</span>
                      <span>·</span>
                      <span>{formatBytes(task.totalSize)}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(task.startTime)}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-2">
                      {task.files.slice(0, 3).map((file) => (
                        <span key={file.id} className="text-lg" title={file.name}>
                          {getFileIcon(file.name)}
                        </span>
                      ))}
                      {task.files.length > 3 && (
                        <span className="text-xs text-dark-400">+{task.files.length - 3}</span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => removeTransfer(task.id)}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-dark-400 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-12 text-center">
            <div className="w-20 h-20 rounded-2xl bg-dark-600 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-10 h-10 text-dark-400" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">暂无历史记录</h3>
            <p className="text-dark-300">开始传输文件后，记录将显示在这里</p>
          </div>
        )}
      </div>
    </div>
  );
}
