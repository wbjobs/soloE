import React from 'react';
import { RenderSettings } from '../types';

interface ControlPanelProps {
  settings: RenderSettings;
  onSettingsChange: (settings: RenderSettings) => void;
  sceneType: 'sphere' | 'maze' | 'terrain' | 'checkerboard';
  onSceneChange: (type: 'sphere' | 'maze' | 'terrain' | 'checkerboard') => void;
  onRebuild: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  settings,
  onSettingsChange,
  sceneType,
  onSceneChange,
  onRebuild,
}) => {
  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 16,
    background: 'rgba(0, 0, 0, 0.8)',
    color: '#fff',
    borderRadius: 8,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    minWidth: 260,
    zIndex: 100,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 12,
    borderBottom: '1px solid #444',
    paddingBottom: 8,
    color: '#60a5fa',
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: 16,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: 6,
    color: '#d1d5db',
    fontSize: 12,
  };

  const sliderContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    accentColor: '#60a5fa',
  };

  const checkboxStyle: React.CSSProperties = {
    marginRight: 8,
    accentColor: '#60a5fa',
  };

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 16px',
    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: 13,
    transition: 'transform 0.1s',
  };

  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    background: '#1f2937',
    color: '#fff',
    border: '1px solid #374151',
    borderRadius: 6,
    fontSize: 13,
  };

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>⚙️ 渲染控制</div>

      <div style={sectionStyle}>
        <label style={labelStyle}>场景类型</label>
        <select
          value={sceneType}
          onChange={(e) => onSceneChange(e.target.value as any)}
          style={selectStyle}
        >
          <option value="sphere">球体</option>
          <option value="maze">迷宫</option>
          <option value="terrain">地形</option>
          <option value="checkerboard">棋盘</option>
        </select>
      </div>

      <div style={sectionStyle}>
        <label style={labelStyle}>
          光线/像素: {settings.raysPerPixel}
        </label>
        <div style={sliderContainerStyle}>
          <input
            type="range"
            min="1"
            max="512"
            value={settings.raysPerPixel}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                raysPerPixel: parseInt(e.target.value),
              })
            }
            style={inputStyle}
          />
        </div>
      </div>

      <div style={sectionStyle}>
        <label style={labelStyle}>
          最大反弹: {settings.maxBounces}
        </label>
        <div style={sliderContainerStyle}>
          <input
            type="range"
            min="1"
            max="10"
            value={settings.maxBounces}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                maxBounces: parseInt(e.target.value),
              })
            }
            style={inputStyle}
          />
        </div>
      </div>

      <div style={sectionStyle}>
        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={settings.showBVH}
            onChange={(e) =>
              onSettingsChange({ ...settings, showBVH: e.target.checked })
            }
            style={checkboxStyle}
          />
          显示 BVH 线框
        </label>
      </div>

      {settings.showBVH && (
        <div style={sectionStyle}>
          <label style={labelStyle}>
            BVH 层级: {settings.bvhLevel}
          </label>
          <div style={sliderContainerStyle}>
            <input
              type="range"
              min="0"
              max="20"
              value={settings.bvhLevel}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  bvhLevel: parseInt(e.target.value),
                })
              }
              style={inputStyle}
            />
          </div>
        </div>
      )}

      <button onClick={onRebuild} style={buttonStyle}>
        🔄 重新构建 BVH
      </button>

      <div style={{ marginTop: 16, fontSize: 11, color: '#6b7280' }}>
        <p>💡 提示: 拖动鼠标旋转视角</p>
        <p>滚轮缩放场景</p>
      </div>
    </div>
  );
};
