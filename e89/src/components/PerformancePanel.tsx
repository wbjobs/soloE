import React from 'react';
import { PerformanceMetrics } from '../types';

interface PerformancePanelProps {
  metrics: PerformanceMetrics;
  voxelCount: number;
  bvhNodeCount: number;
  bvhBuildTime: number;
}

export const PerformancePanel: React.FC<PerformancePanelProps> = ({
  metrics,
  voxelCount,
  bvhNodeCount,
  bvhBuildTime,
}) => {
  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: 16,
    left: 16,
    padding: 16,
    background: 'rgba(0, 0, 0, 0.8)',
    color: '#fff',
    borderRadius: 8,
    fontFamily: 'monospace',
    fontSize: 13,
    minWidth: 220,
    zIndex: 100,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 12,
    borderBottom: '1px solid #444',
    paddingBottom: 8,
    color: '#4ade80',
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 6,
  };

  const labelStyle: React.CSSProperties = {
    color: '#9ca3af',
  };

  const valueStyle: React.CSSProperties = {
    color: '#fbbf24',
    fontWeight: 'bold',
  };

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>📊 性能面板</div>
      <div style={rowStyle}>
        <span style={labelStyle}>帧率 (FPS):</span>
        <span style={valueStyle}>{metrics.fps.toFixed(1)}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>帧时间:</span>
        <span style={valueStyle}>{metrics.frameTime.toFixed(2)} ms</span>
      </div>
      <div style={{ height: 8 }} />
      <div style={rowStyle}>
        <span style={labelStyle}>BVH 构建时间:</span>
        <span style={valueStyle}>{bvhBuildTime.toFixed(2)} ms</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>体素数量:</span>
        <span style={valueStyle}>{voxelCount.toLocaleString()}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>BVH 节点数:</span>
        <span style={valueStyle}>{bvhNodeCount.toLocaleString()}</span>
      </div>
      <div style={{ height: 8 }} />
      <div style={rowStyle}>
        <span style={labelStyle}>平均遍历节点:</span>
        <span style={valueStyle}>{metrics.avgTraversalCount.toFixed(1)}</span>
      </div>
    </div>
  );
};
