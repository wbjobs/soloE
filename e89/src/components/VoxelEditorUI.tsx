import React from 'react';

export type EditMode = 'add' | 'remove' | 'none';

interface VoxelEditorUIProps {
  editMode: EditMode;
  onModeChange: (mode: EditMode) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  voxelValue: number;
  onVoxelValueChange: (value: number) => void;
  lastEditTime: number;
}

export const VoxelEditorUI: React.FC<VoxelEditorUIProps> = ({
  editMode,
  onModeChange,
  brushSize,
  onBrushSizeChange,
  voxelValue,
  onVoxelValueChange,
  lastEditTime,
}) => {
  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 16,
    left: 16,
    padding: 16,
    background: 'rgba(0, 0, 0, 0.85)',
    color: '#fff',
    borderRadius: 8,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    minWidth: 280,
    zIndex: 100,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 12,
    borderBottom: '1px solid #444',
    paddingBottom: 8,
    color: '#f472b6',
  };

  const buttonGroupStyle: React.CSSProperties = {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
  };

  const getButtonStyle = (mode: EditMode): React.CSSProperties => ({
    flex: 1,
    padding: '8px 12px',
    background: editMode === mode
      ? (mode === 'add' ? 'linear-gradient(135deg, #10b981, #059669)' :
         mode === 'remove' ? 'linear-gradient(135deg, #ef4444, #dc2626)' :
         '#374151')
      : '#1f2937',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: 12,
    transition: 'transform 0.1s',
  });

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: 6,
    color: '#d1d5db',
    fontSize: 12,
  };

  const rowStyle: React.CSSProperties = {
    marginBottom: 12,
  };

  const colorPreviewStyle: React.CSSProperties = {
    width: 24,
    height: 24,
    borderRadius: 4,
    background: `hsl(${(voxelValue / 255) * 360}, 70%, 50%)`,
    border: '2px solid #374151',
  };

  const getModeText = (mode: EditMode): string => {
    switch (mode) {
      case 'add': return '➕ 添加';
      case 'remove': return '➖ 删除';
      default: return '👁️ 查看';
    }
  };

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>🎨 体素编辑器</div>

      <div style={buttonGroupStyle}>
        <button
          onClick={() => onModeChange('none')}
          style={getButtonStyle('none')}
        >
          👁️ 查看
        </button>
        <button
          onClick={() => onModeChange('add')}
          style={getButtonStyle('add')}
        >
          ➕ 添加
        </button>
        <button
          onClick={() => onModeChange('remove')}
          style={getButtonStyle('remove')}
        >
          ➖ 删除
        </button>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle}>当前模式: {getModeText(editMode)}</label>
      </div>

      {editMode !== 'none' && (
        <>
          <div style={rowStyle}>
            <label style={labelStyle}>
              画笔大小: {brushSize}
            </label>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={brushSize}
              onChange={(e) => onBrushSizeChange(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: '#f472b6' }}
            />
          </div>

          {editMode === 'add' && (
            <div style={rowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <span style={labelStyle}>体素颜色:</span>
                <div style={colorPreviewStyle} />
                <span style={{ color: '#9ca3af', fontSize: 11 }}>
                  HSL: {Math.round((voxelValue / 255) * 360)}°
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="255"
                value={voxelValue}
                onChange={(e) => onVoxelValueChange(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: '#f472b6' }}
              />
            </div>
          )}
        </>
      )}

      {lastEditTime > 0 && (
        <div style={{
          marginTop: 8,
          padding: '8px 12px',
          background: 'rgba(16, 185, 129, 0.2)',
          borderRadius: 4,
          borderLeft: '3px solid #10b981',
        }}>
          <span style={{ color: '#6ee7b7', fontSize: 11 }}>
            ⚡ 上次更新: {lastEditTime.toFixed(2)}ms
          </span>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: '#6b7280' }}>
        <p>💡 左键点击进行编辑</p>
        <p>切换到"查看"模式可自由旋转视角</p>
      </div>
    </div>
  );
};
