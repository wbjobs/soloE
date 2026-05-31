import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TransferReport } from '../types';

interface TransferReportViewProps {
  report: TransferReport;
  onClose: () => void;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds % 60}s`;
};

export default function TransferReportView({ report, onClose }: TransferReportViewProps) {
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());

  const toggleChunk = (index: number) => {
    const newExpanded = new Set(expandedChunks);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedChunks(newExpanded);
  };

  const exportReport = async () => {
    try {
      const json = await invoke<string>('export_report', { reportId: report.report_id });
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transfer-report-${report.report_id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export report:', error);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>传输报告</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="report-summary">
          <div className="summary-item">
            <span className="summary-label">文件名</span>
            <span className="summary-value">{report.file_name}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">文件大小</span>
            <span className="summary-value">{formatSize(report.file_size)}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">对等设备</span>
            <span className="summary-value">{report.peer_name}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">传输方向</span>
            <span className="summary-value">{report.direction === 'send' ? '发送' : '接收'}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">总耗时</span>
            <span className="summary-value">{formatDuration(report.total_duration_ms)}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">平均速度</span>
            <span className="summary-value">{report.average_speed_mbps.toFixed(2)} Mbps</span>
          </div>
          <div className="summary-item success">
            <span className="summary-label">成功分片</span>
            <span className="summary-value">{report.successful_chunks} / {report.total_chunks}</span>
          </div>
          <div className="summary-item warning">
            <span className="summary-label">重试次数</span>
            <span className="summary-value">{report.total_retries}</span>
          </div>
          <div className="summary-item error">
            <span className="summary-label">失败分片</span>
            <span className="summary-value">{report.failed_chunks}</span>
          </div>
        </div>

        <div className="report-chunks">
          <h3>分片详情</h3>
          <div className="chunks-list">
            {report.chunk_records
              .sort((a, b) => a.chunk_index - b.chunk_index)
              .map((chunk) => (
              <div key={chunk.chunk_index} className="chunk-item">
                <div
                  className={`chunk-header ${chunk.success ? 'success' : 'error'}`}
                  onClick={() => toggleChunk(chunk.chunk_index)}
                >
                  <span className="chunk-index">分片 #{chunk.chunk_index}</span>
                  <span className="chunk-duration">{chunk.duration_ms}ms</span>
                  {chunk.retry_count > 0 && (
                    <span className="chunk-retries">({chunk.retry_count} 重试)</span>
                  )}
                </div>
                {expandedChunks.has(chunk.chunk_index) && (
                  <div className="chunk-details">
                    <p>开始: {new Date(chunk.start_time).toLocaleString()}</p>
                    <p>结束: {new Date(chunk.end_time).toLocaleString()}</p>
                    <p className="chunk-hash">
                      Hash: <code>{chunk.hash}</code>
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="report-actions">
          <button className="btn btn-primary" onClick={exportReport}>
            导出报告
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
