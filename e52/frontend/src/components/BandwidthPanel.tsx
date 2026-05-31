import { useState, useEffect } from 'react';
import { BandwidthStatus, BandwidthConfig, SpeedHistory } from '../types';
import { getBandwidthStatus, updateBandwidthConfig, getSpeedHistory } from '../services/api';

export default function BandwidthPanel() {
  const [status, setStatus] = useState<BandwidthStatus | null>(null);
  const [history, setHistory] = useState<SpeedHistory | null>(null);
  const [editing, setEditing] = useState(false);
  const [config, setConfig] = useState<BandwidthConfig>({
    enabled: true,
    uploadLimitKBps: 10240,
    downloadLimitKBps: 20480,
  });

  useEffect(() => {
    fetchBandwidthStatus();
    const interval = setInterval(fetchBandwidthStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchSpeedHistory();
    const interval = setInterval(fetchSpeedHistory, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchBandwidthStatus = async () => {
    try {
      const data = await getBandwidthStatus();
      setStatus(data);
      if (!editing) {
        setConfig(data.config);
      }
    } catch (error) {
      console.error('Failed to fetch bandwidth status:', error);
    }
  };

  const fetchSpeedHistory = async () => {
    try {
      const data = await getSpeedHistory();
      setHistory(data);
    } catch (error) {
      console.error('Failed to fetch speed history:', error);
    }
  };

  const handleSaveConfig = async () => {
    try {
      await updateBandwidthConfig(config);
      setEditing(false);
      fetchBandwidthStatus();
    } catch (error) {
      console.error('Failed to update config:', error);
    }
  };

  const formatSpeed = (bps: number): string => {
    if (bps < 1024) return `${bps} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-800">带宽控制</h2>
        <label className="flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            className="sr-only"
          />
          <div className={`w-12 h-6 rounded-full transition-colors ${
            config.enabled ? 'bg-blue-500' : 'bg-gray-300'
          }`}>
            <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform mt-0.5 ${
              config.enabled ? 'translate-x-6' : 'translate-x-0.5'
            }`} />
          </div>
          <span className="ml-2 text-sm text-gray-600">
            {config.enabled ? '带宽友好模式' : '无限制模式'}
          </span>
        </label>
      </div>

      {status && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4">
            <div className="text-sm text-blue-600 mb-1">上传速度</div>
            <div className="text-2xl font-bold text-blue-700">
              {formatSpeed(status.currentUploadSpeedBps)}
            </div>
            <div className="text-xs text-blue-500 mt-1">
              总计: {formatBytes(status.totalUploaded)}
            </div>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4">
            <div className="text-sm text-green-600 mb-1">下载速度</div>
            <div className="text-2xl font-bold text-green-700">
              {formatSpeed(status.currentDownloadSpeedBps)}
            </div>
            <div className="text-xs text-green-500 mt-1">
              总计: {formatBytes(status.totalDownloaded)}
            </div>
          </div>
        </div>
      )}

      <div className="border-t pt-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-gray-700">速度限制设置</h3>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-blue-500 hover:text-blue-600"
            >
              编辑
            </button>
          ) : (
            <div className="space-x-2">
              <button
                onClick={() => {
                  setEditing(false);
                  setConfig(status?.config || config);
                }}
                className="text-sm text-gray-500 hover:text-gray-600"
              >
                取消
              </button>
              <button
                onClick={handleSaveConfig}
                className="text-sm text-blue-500 hover:text-blue-600 font-medium"
              >
                保存
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-2">
              上传限制: {(config.uploadLimitKBps / 1024).toFixed(1)} MB/s
            </label>
            <input
              type="range"
              min="128"
              max="51200"
              step="128"
              value={config.uploadLimitKBps}
              onChange={(e) => setConfig({ ...config, uploadLimitKBps: parseInt(e.target.value) })}
              disabled={!editing}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-2">
              下载限制: {(config.downloadLimitKBps / 1024).toFixed(1)} MB/s
            </label>
            <input
              type="range"
              min="256"
              max="102400"
              step="256"
              value={config.downloadLimitKBps}
              onChange={(e) => setConfig({ ...config, downloadLimitKBps: parseInt(e.target.value) })}
              disabled={!editing}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      {history && (history.upload.length > 0 || history.download.length > 0) && (
        <div className="border-t mt-6 pt-4">
          <h3 className="font-semibold text-gray-700 mb-4">速度历史 (最近60秒)</h3>
          <div className="h-32 flex items-end space-x-1">
            {history.upload.slice(-30).map((sample, index) => (
              <div key={index} className="flex-1 flex flex-col items-center">
                <div
                  className="w-full bg-blue-400 rounded-t min-w-1"
                  style={{ height: `${Math.min(100, (sample.speedKBps / 10000) * 100)}%` }}
                  title={`上传: ${sample.speedKBps} KB/s`}
                />
                <div
                  className="w-full bg-green-400 min-w-1"
                  style={{ height: `${Math.min(100, ((history.download[index]?.speedKBps || 0) / 20000) * 100)}%` }}
                  title={`下载: ${history.download[index]?.speedKBps || 0} KB/s`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-center space-x-6 mt-2 text-xs text-gray-500">
            <span className="flex items-center">
              <span className="w-3 h-3 bg-blue-400 rounded mr-1" /> 上传
            </span>
            <span className="flex items-center">
              <span className="w-3 h-3 bg-green-400 rounded mr-1" /> 下载
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
