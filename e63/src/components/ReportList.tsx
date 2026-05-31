import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TransferReport } from '../types';
import TransferReportView from './TransferReportView';

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

export default function ReportList() {
  const [reports, setReports] = useState<TransferReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<TransferReport | null>(null);

  const loadReports = async () => {
    try {
      const data = await invoke<TransferReport[]>('get_all_reports');
      setReports(data);
    } catch (error) {
      console.error('Failed to load reports:', error);
    }
  };

  useEffect(() => {
    loadReports();
    const interval = setInterval(loadReports, 5000);
    return () => clearInterval(interval);
  }, []);

  if (reports.length === 0) {
    return (
      <div className="card">
        <h2 className="card-title">传输报告</h2>
        <div className="no-reports">
          <p>暂无传输报告</p>
          <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.5)' }}>
            完成文件传输后，报告会自动生成
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <h2 className="card-title">传输报告 ({reports.length})</h2>
        <div className="report-list">
          {reports
            .sort((a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime())
            .map((report) => (
            <div
              key={report.report_id}
              className={`report-item ${report.success ? 'success' : 'error'}`}
              onClick={() => setSelectedReport(report)}
            >
              <div className="report-file-name">{report.file_name}</div>
              <div className="report-meta">
                <span className="report-peer">{report.peer_name}</span>
                <span className="report-direction">
                  {report.direction === 'send' ? '→' : '←'}
                </span>
                <span className="report-size">{formatSize(report.file_size)}</span>
                <span className="report-speed">{report.average_speed_mbps.toFixed(2)} Mbps</span>
              </div>
              <div className="report-time">
                {new Date(report.end_time).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedReport && (
        <TransferReportView
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
        />
      )}
    </>
  );
}
