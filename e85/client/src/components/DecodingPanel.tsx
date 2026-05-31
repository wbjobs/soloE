import React, { useState } from 'react';
import { DecodingResult, DecodingLog } from '../types';
import { getSuspicionLevel } from '../utils/detection';

interface DecodingPanelProps {
  decodingResult: DecodingResult | null;
  decodingHistory: DecodingLog[];
  isDecoding: boolean;
  suspicionScore: number;
  onDecode: () => void;
  onExportHex: () => string | null;
  onExportText: () => string | null;
  onDownloadFile: (content: string, filename: string, mimeType: string) => void;
  onFetchHistory: () => void;
}

export const DecodingPanel: React.FC<DecodingPanelProps> = ({
  decodingResult,
  decodingHistory,
  isDecoding,
  suspicionScore,
  onDecode,
  onExportHex,
  onExportText,
  onDownloadFile,
  onFetchHistory
}) => {
  const [viewMode, setViewMode] = useState<'hex' | 'text'>('hex');

  const handleExportHex = () => {
    const content = onExportHex();
    if (content) {
      onDownloadFile(content, `decoded_${Date.now()}.hex`, 'text/plain');
    }
  };

  const handleExportText = () => {
    const content = onExportText();
    if (content) {
      onDownloadFile(content, `decoded_${Date.now()}.txt`, 'text/plain');
    }
  };

  const canDecode = suspicionScore >= 0.5;

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>隐蔽信道数据复原</h2>

      <div style={styles.buttonRow}>
        <button
          style={{
            ...styles.primaryBtn,
            opacity: canDecode ? 1 : 0.5,
            cursor: canDecode ? 'pointer' : 'not-allowed'
          }}
          onClick={onDecode}
          disabled={isDecoding || !canDecode}
        >
          {isDecoding ? '解码中...' : '尝试解码隐藏数据'}
        </button>
        <button style={styles.secondaryBtn} onClick={onFetchHistory}>
          刷新解码历史
        </button>
      </div>

      {!canDecode && (
        <div style={styles.warningBox}>
          <span style={styles.warningIcon}>⚠️</span>
          <span style={styles.warningText}>
            可疑度较低 ({(suspicionScore * 100).toFixed(1)}%)，需要可疑度 ≥ 50% 才能尝试解码
          </span>
        </div>
      )}

      {decodingResult && (
        <div style={styles.resultContainer}>
          <div style={styles.resultHeader}>
            <div style={styles.resultStatus}>
              <span
                style={{
                  ...styles.statusBadge,
                  backgroundColor: decodingResult.success ? '#22c55e' : '#64748b'
                }}
              >
                {decodingResult.success ? '解码成功' : '解码失败'}
              </span>
              <span style={styles.confidence}>
                可信度: {(decodingResult.confidence * 100).toFixed(1)}%
              </span>
            </div>
            <div style={styles.resultMeta}>
              <span style={styles.metaItem}>方法: {decodingResult.method}</span>
              <span style={styles.metaItem}>
                {decodingResult.bitCount} 比特 / {decodingResult.byteCount} 字节
              </span>
              <span style={styles.metaItem}>编码: {decodingResult.encodingType}</span>
            </div>
          </div>

          {decodingResult.success ? (
            <>
              <div style={styles.viewToggle}>
                <button
                  style={{
                    ...styles.toggleBtn,
                    backgroundColor: viewMode === 'hex' ? '#3b82f6' : '#334155'
                  }}
                  onClick={() => setViewMode('hex')}
                >
                  十六进制
                </button>
                <button
                  style={{
                    ...styles.toggleBtn,
                    backgroundColor: viewMode === 'text' ? '#3b82f6' : '#334155'
                  }}
                  onClick={() => setViewMode('text')}
                >
                  文本
                </button>
                <div style={styles.exportButtons}>
                  <button style={styles.exportBtn} onClick={handleExportHex}>
                    导出 HEX
                  </button>
                  <button style={styles.exportBtn} onClick={handleExportText}>
                    导出文本
                  </button>
                </div>
              </div>

              <div style={styles.dataContainer}>
                {viewMode === 'hex' ? (
                  <pre style={styles.dataPre}>{decodingResult.hex || '(无数据)'}</pre>
                ) : (
                  <pre style={styles.dataPre}>{decodingResult.text || '(无数据)'}</pre>
                )}
              </div>

              {decodingResult.rawBits.length > 0 && (
                <div style={styles.bitsSection}>
                  <div style={styles.sectionTitle}>原始比特流 (前 128 位)</div>
                  <div style={styles.bitsContainer}>
                    {decodingResult.rawBits.slice(0, 128).split('').map((bit, idx) => (
                      <span
                        key={idx}
                        style={{
                          ...styles.bit,
                          backgroundColor: bit === '1' ? '#3b82f6' : '#1e293b'
                        }}
                      >
                        {bit}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={styles.failureMessage}>
              <p style={styles.failureText}>{decodingResult.details}</p>
              {decodingResult.bitCount > 0 && (
                <p style={styles.failureSubtext}>
                  提取了 {decodingResult.bitCount} 比特，但未识别到有效编码模式
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {decodingHistory.length > 0 && (
        <div style={styles.historySection}>
          <h3 style={styles.sectionTitle}>解码历史</h3>
          <div style={styles.historyList}>
            {decodingHistory.slice(0, 10).map((log, idx) => {
              const suspicionInfo = getSuspicionLevel(log.suspicionScore);
              return (
                <div
                  key={idx}
                  style={{
                    ...styles.historyItem,
                    borderLeftColor: log.decodingSuccess ? '#22c55e' : '#64748b',
                    backgroundColor: log.decodingSuccess ? 'rgba(34, 197, 94, 0.05)' : 'transparent'
                  }}
                >
                  <div style={styles.historyLeft}>
                    <div style={styles.historyTime}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </div>
                    <div style={styles.historyMeta}>
                      <span
                        style={{
                          ...styles.historyBadge,
                          backgroundColor: log.decodingSuccess ? '#22c55e' : '#64748b'
                        }}
                      >
                        {log.decodingSuccess ? '成功' : '失败'}
                      </span>
                      <span style={styles.historyText}>{log.decodingMethod}</span>
                    </div>
                    {log.decodingSuccess && log.textData && (
                      <div style={styles.historyPreview}>{log.textData.slice(0, 50)}...</div>
                    )}
                  </div>
                  <div style={styles.historyRight}>
                    <div style={{ ...styles.historyScore, color: suspicionInfo.color }}>
                      {(log.confidence * 100).toFixed(0)}%
                    </div>
                    <div style={styles.historySize}>
                      {log.byteCount}B
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '20px'
  },
  cardTitle: {
    margin: '0 0 20px 0',
    color: '#f1f5f9',
    fontSize: '18px',
    fontWeight: 600
  },
  buttonRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginBottom: '16px'
  },
  primaryBtn: {
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  secondaryBtn: {
    backgroundColor: '#334155',
    color: '#f1f5f9',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  warningBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 16px',
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    border: '1px solid rgba(234, 179, 8, 0.3)',
    borderRadius: '8px',
    marginBottom: '16px'
  },
  warningIcon: {
    fontSize: '18px'
  },
  warningText: {
    color: '#fbbf24',
    fontSize: '13px'
  },
  resultContainer: {
    marginTop: '16px'
  },
  resultHeader: {
    backgroundColor: '#0f172a',
    borderRadius: '12px',
    padding: '16px 20px',
    marginBottom: '16px'
  },
  resultStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px'
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    color: 'white',
    fontSize: '12px',
    fontWeight: 500
  },
  confidence: {
    color: '#94a3b8',
    fontSize: '13px'
  },
  resultMeta: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap'
  },
  metaItem: {
    color: '#64748b',
    fontSize: '12px',
    fontFamily: 'monospace'
  },
  viewToggle: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
    alignItems: 'center'
  },
  toggleBtn: {
    backgroundColor: '#334155',
    color: '#f1f5f9',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  exportButtons: {
    marginLeft: 'auto',
    display: 'flex',
    gap: '8px'
  },
  exportBtn: {
    backgroundColor: '#1e293b',
    color: '#94a3b8',
    border: '1px solid #334155',
    padding: '6px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  dataContainer: {
    backgroundColor: '#0f172a',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    maxHeight: '200px',
    overflow: 'auto'
  },
  dataPre: {
    margin: 0,
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: '13px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all'
  },
  bitsSection: {
    backgroundColor: '#0f172a',
    borderRadius: '8px',
    padding: '16px'
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    color: '#94a3b8',
    fontSize: '13px',
    fontWeight: 500
  },
  bitsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '3px'
  },
  bit: {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '3px',
    fontSize: '11px',
    fontFamily: 'monospace',
    color: '#f1f5f9'
  },
  failureMessage: {
    backgroundColor: '#0f172a',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center'
  },
  failureText: {
    color: '#94a3b8',
    fontSize: '14px',
    margin: '0 0 8px 0'
  },
  failureSubtext: {
    color: '#64748b',
    fontSize: '12px',
    margin: 0
  },
  historySection: {
    marginTop: '20px',
    borderTop: '1px solid #334155',
    paddingTop: '16px'
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '250px',
    overflowY: 'auto'
  },
  historyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '12px',
    borderRadius: '8px',
    borderLeft: '3px solid #334155'
  },
  historyLeft: {
    flex: 1
  },
  historyTime: {
    color: '#f1f5f9',
    fontSize: '13px',
    fontWeight: 500,
    marginBottom: '4px'
  },
  historyMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px'
  },
  historyBadge: {
    padding: '2px 8px',
    borderRadius: '10px',
    color: 'white',
    fontSize: '10px',
    fontWeight: 500
  },
  historyText: {
    color: '#64748b',
    fontSize: '12px',
    fontFamily: 'monospace'
  },
  historyPreview: {
    color: '#94a3b8',
    fontSize: '12px',
    fontFamily: 'monospace'
  },
  historyRight: {
    textAlign: 'right'
  },
  historyScore: {
    fontSize: '16px',
    fontWeight: 600,
    marginBottom: '2px'
  },
  historySize: {
    color: '#64748b',
    fontSize: '11px'
  }
};
