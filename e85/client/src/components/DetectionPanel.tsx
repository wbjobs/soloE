import React from 'react';
import { DetectionMetrics, DetectionReport, BaselineProfile } from '../types';
import { getSuspicionLevel, getBaselineStatus, BASELINE_PACKET_COUNT } from '../utils/detection';

interface DetectionPanelProps {
  metrics: DetectionMetrics | null;
  reportHistory: DetectionReport[];
  isAnalyzing: boolean;
  isChannelOpen: boolean;
  baseline: BaselineProfile;
  onAnalyze: () => void;
  onStartAuto: () => void;
  onStopAuto: () => void;
  onClear: () => void;
  onResetBaseline: () => void;
  onRebuildBaseline: () => void;
  onFetchHistory: () => void;
}

export const DetectionPanel: React.FC<DetectionPanelProps> = ({
  metrics,
  reportHistory,
  isAnalyzing,
  isChannelOpen,
  baseline,
  onAnalyze,
  onStartAuto,
  onStopAuto,
  onClear,
  onResetBaseline,
  onRebuildBaseline,
  onFetchHistory
}) => {
  const baselineStatus = getBaselineStatus(baseline);

  const renderScoreBar = (score: number, label: string) => {
    const { color } = getSuspicionLevel(score);
    return (
      <div style={styles.metricItem}>
        <div style={styles.metricHeader}>
          <span style={styles.metricLabel}>{label}</span>
          <span style={{ ...styles.metricValue, color }}>{(score * 100).toFixed(1)}%</span>
        </div>
        <div style={styles.progressBg}>
          <div
            style={{
              ...styles.progressFill,
              width: `${score * 100}%`,
              backgroundColor: color
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>隐蔽信道检测</h2>

      <div style={styles.buttonRow}>
        <button
          style={styles.primaryBtn}
          onClick={onAnalyze}
          disabled={!isChannelOpen}
        >
          立即分析
        </button>
        {!isAnalyzing ? (
          <button
            style={styles.secondaryBtn}
            onClick={onStartAuto}
            disabled={!isChannelOpen}
          >
            开始自动检测
          </button>
        ) : (
          <button style={styles.dangerBtn} onClick={onStopAuto}>
            停止自动检测
          </button>
        )}
        <button style={styles.secondaryBtn} onClick={onClear}>
          清空数据
        </button>
        <button style={styles.secondaryBtn} onClick={onFetchHistory}>
          刷新历史
        </button>
      </div>

      <div style={styles.baselineSection}>
        <div style={styles.baselineHeader}>
          <span style={styles.baselineLabel}>基线状态</span>
          <span style={{ ...styles.baselineStatus, color: baselineStatus.color }}>
            {baselineStatus.status}
          </span>
        </div>
        <div style={styles.baselineProgressBg}>
          <div
            style={{
              ...styles.baselineProgressFill,
              width: `${baselineStatus.progress}%`,
              backgroundColor: baselineStatus.color
            }}
          />
        </div>
        <div style={styles.baselineInfo}>
          <span style={styles.baselineProgressText}>
            {baseline.baselinePacketCount}/{BASELINE_PACKET_COUNT} 包
          </span>
          {baseline.isEstablished && (
            <span style={styles.baselineDetails}>
              基线抖动: {baseline.baselineJitter.toFixed(1)}ms · 基线乱序率: {(baseline.baselineReorderRate * 100).toFixed(2)}%
            </span>
          )}
        </div>
        <div style={styles.baselineButtons}>
          <button
            style={styles.baselineBtn}
            onClick={onResetBaseline}
          >
            清除基线
          </button>
          <button
            style={styles.baselineBtn}
            onClick={onRebuildBaseline}
            disabled={baseline.baselinePacketCount < 20}
          >
            重建基线
          </button>
        </div>
      </div>

      {isAnalyzing && (
        <div style={styles.analyzingIndicator}>
          <div style={styles.spinner} />
          <span>正在自动检测中 (每 5 秒)...</span>
        </div>
      )}

      {metrics && (
        <div style={styles.metricsContainer}>
          <div style={styles.mainScoreContainer}>
            <div style={styles.mainScoreLabel}>总体可疑度评分</div>
            <div
              style={{
                ...styles.mainScore,
                color: getSuspicionLevel(metrics.overallSuspicion).color
              }}
            >
              {(metrics.overallSuspicion * 100).toFixed(1)}%
            </div>
            <div
              style={{
                ...styles.suspicionLevel,
                backgroundColor: getSuspicionLevel(metrics.overallSuspicion).color
              }}
            >
              {getSuspicionLevel(metrics.overallSuspicion).level}
            </div>
            {!baseline.isEstablished && metrics.totalPackets > 0 && (
              <div style={styles.baselineWarning}>
                ⚠️ 基线未建立，检测结果仅供参考
              </div>
            )}
          </div>

          <div style={styles.scoreBars}>
            {renderScoreBar(metrics.reorderScore, '包序重排可疑度')}
            {renderScoreBar(metrics.jitterScore, '延迟抖动可疑度')}
            {baseline.isEstablished && renderScoreBar(metrics.anomalyPatternScore || 0, '异常模式得分')}
          </div>

          <div style={styles.statsGrid}>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>总包数</div>
              <div style={styles.statValue}>{metrics.totalPackets}</div>
            </div>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>乱序包数</div>
              <div style={{
                ...styles.statValue,
                color: metrics.reorderedPackets > 0 ? '#f97316' : '#22c55e'
              }}>
                {metrics.reorderedPackets}
              </div>
            </div>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>平均延迟</div>
              <div style={styles.statValue}>{metrics.avgLatency.toFixed(1)} ms</div>
            </div>
            <div style={styles.statBox}>
              <div style={styles.statLabel}>抖动</div>
              <div style={styles.statValue}>{metrics.jitter.toFixed(1)} ms</div>
            </div>
          </div>
        </div>
      )}

      {reportHistory.length > 0 && (
        <div style={styles.historySection}>
          <h3 style={styles.sectionTitle}>检测历史</h3>
          <div style={styles.historyList}>
            {reportHistory.slice(0, 10).map((report, idx) => {
              const { color, level } = getSuspicionLevel(report.overallSuspicion);
              const isAbnormal = report.overallSuspicion >= 0.5;
              return (
                <div
                  key={idx}
                  style={{
                    ...styles.historyItem,
                    borderLeftColor: color,
                    backgroundColor: isAbnormal ? 'rgba(249, 115, 22, 0.05)' : 'transparent'
                  }}
                >
                  <div style={styles.historyLeft}>
                    <div style={styles.historyTime}>
                      {new Date(report.timestamp).toLocaleTimeString()}
                    </div>
                    <div style={styles.historyMeta}>
                      {report.totalPackets} 包 · 乱序 {report.reorderedPackets} · {report.avgLatency.toFixed(0)}ms
                    </div>
                  </div>
                  <div style={styles.historyRight}>
                    <div style={{ ...styles.historyScore, color }}>
                      {(report.overallSuspicion * 100).toFixed(0)}%
                    </div>
                    <div
                      style={{
                        ...styles.historyLevel,
                        backgroundColor: color
                      }}
                    >
                      {level}
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
  dangerBtn: {
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  baselineSection: {
    backgroundColor: '#0f172a',
    borderRadius: '12px',
    padding: '16px 20px',
    marginBottom: '16px'
  },
  baselineHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px'
  },
  baselineLabel: {
    color: '#94a3b8',
    fontSize: '13px',
    fontWeight: 500
  },
  baselineStatus: {
    fontSize: '13px',
    fontWeight: 600
  },
  baselineProgressBg: {
    height: '6px',
    backgroundColor: '#1e293b',
    borderRadius: '3px',
    overflow: 'hidden',
    marginBottom: '8px'
  },
  baselineProgressFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.3s ease'
  },
  baselineInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    flexWrap: 'wrap',
    gap: '8px'
  },
  baselineProgressText: {
    color: '#64748b',
    fontSize: '12px'
  },
  baselineDetails: {
    color: '#94a3b8',
    fontSize: '12px',
    fontFamily: 'monospace'
  },
  baselineButtons: {
    display: 'flex',
    gap: '10px'
  },
  baselineBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    color: '#94a3b8',
    border: '1px solid #334155',
    padding: '8px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  analyzingIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 16px',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    borderRadius: '8px',
    marginBottom: '20px',
    color: '#60a5fa'
  },
  spinner: {
    width: '16px',
    height: '16px',
    border: '2px solid rgba(59, 130, 246, 0.3)',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  metricsContainer: {
    marginTop: '20px'
  },
  mainScoreContainer: {
    textAlign: 'center',
    padding: '24px',
    backgroundColor: '#0f172a',
    borderRadius: '12px',
    marginBottom: '20px'
  },
  mainScoreLabel: {
    color: '#94a3b8',
    fontSize: '14px',
    marginBottom: '8px'
  },
  mainScore: {
    fontSize: '48px',
    fontWeight: 700,
    lineHeight: 1,
    marginBottom: '8px'
  },
  suspicionLevel: {
    display: 'inline-block',
    padding: '4px 16px',
    borderRadius: '20px',
    color: 'white',
    fontSize: '12px',
    fontWeight: 500
  },
  baselineWarning: {
    marginTop: '12px',
    padding: '8px 12px',
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    border: '1px solid rgba(234, 179, 8, 0.3)',
    borderRadius: '6px',
    color: '#fbbf24',
    fontSize: '12px'
  },
  scoreBars: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    marginBottom: '20px'
  },
  metricItem: {
    flex: 1
  },
  metricHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '6px'
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: '13px'
  },
  metricValue: {
    fontSize: '13px',
    fontWeight: 600
  },
  progressBg: {
    height: '8px',
    backgroundColor: '#0f172a',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 0.3s ease'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '12px'
  },
  statBox: {
    backgroundColor: '#0f172a',
    padding: '16px',
    borderRadius: '8px',
    textAlign: 'center'
  },
  statLabel: {
    color: '#64748b',
    fontSize: '12px',
    marginBottom: '4px'
  },
  statValue: {
    color: '#f1f5f9',
    fontSize: '18px',
    fontWeight: 600
  },
  historySection: {
    marginTop: '24px',
    borderTop: '1px solid #334155',
    paddingTop: '16px'
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    color: '#cbd5e1',
    fontSize: '14px',
    fontWeight: 500
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '300px',
    overflowY: 'auto'
  },
  historyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    borderRadius: '8px',
    borderLeft: '3px solid #334155',
    transition: 'background-color 0.2s'
  },
  historyLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  historyTime: {
    color: '#f1f5f9',
    fontSize: '13px',
    fontWeight: 500
  },
  historyMeta: {
    color: '#64748b',
    fontSize: '12px'
  },
  historyRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  historyScore: {
    fontSize: '16px',
    fontWeight: 600
  },
  historyLevel: {
    padding: '3px 10px',
    borderRadius: '12px',
    color: 'white',
    fontSize: '11px',
    fontWeight: 500
  }
};
