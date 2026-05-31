import React from 'react';
import { CubeData } from '../utils/cubeParser';

interface OrbitalControlPanelProps {
  cubeData: CubeData | null;
  positiveIso: number;
  negativeIso: number;
  onPositiveIsoChange: (value: number) => void;
  onNegativeIsoChange: (value: number) => void;
  showPositive: boolean;
  showNegative: boolean;
  onShowPositiveChange: (show: boolean) => void;
  onShowNegativeChange: (show: boolean) => void;
  opacity: number;
  onOpacityChange: (value: number) => void;
}

const OrbitalControlPanel: React.FC<OrbitalControlPanelProps> = ({
  cubeData,
  positiveIso,
  negativeIso,
  onPositiveIsoChange,
  onNegativeIsoChange,
  showPositive,
  showNegative,
  onShowPositiveChange,
  onShowNegativeChange,
  opacity,
  onOpacityChange
}) => {
  if (!cubeData) return null;

  const range = cubeData.maxValue - cubeData.minValue;
  const step = range / 100;

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500"></span>
        分子轨道控制
      </h3>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-slate-300">正值等值面</label>
            <input
              type="checkbox"
              checked={showPositive}
              onChange={(e) => onShowPositiveChange(e.target.checked)}
              className="w-4 h-4 accent-cyan-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-cyan-400"></div>
            <input
              type="range"
              min={0}
              max={cubeData.maxValue}
              step={step}
              value={positiveIso}
              onChange={(e) => onPositiveIsoChange(parseFloat(e.target.value))}
              disabled={!showPositive}
              className="flex-1 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
            <span className="text-xs text-cyan-400 font-mono w-16 text-right">
              {positiveIso.toFixed(3)}
            </span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-slate-300">负值等值面</label>
            <input
              type="checkbox"
              checked={showNegative}
              onChange={(e) => onShowNegativeChange(e.target.checked)}
              className="w-4 h-4 accent-red-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-red-500"></div>
            <input
              type="range"
              min={cubeData.minValue}
              max={0}
              step={step}
              value={negativeIso}
              onChange={(e) => onNegativeIsoChange(parseFloat(e.target.value))}
              disabled={!showNegative}
              className="flex-1 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-red-500"
            />
            <span className="text-xs text-red-400 font-mono w-16 text-right">
              {negativeIso.toFixed(3)}
            </span>
          </div>
        </div>

        <div className="border-t border-slate-700 pt-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-slate-300">透明度</label>
          </div>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-slate-400"
          />
          <div className="text-xs text-slate-400 text-right mt-1">
            {(opacity * 100).toFixed(0)}%
          </div>
        </div>

        <div className="border-t border-slate-700 pt-4">
          <h4 className="text-sm text-slate-400 mb-2">数据信息</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-700 rounded p-2">
              <div className="text-slate-400">网格尺寸</div>
              <div className="text-white font-mono">
                {cubeData.dimensions.nx} × {cubeData.dimensions.ny} × {cubeData.dimensions.nz}
              </div>
            </div>
            <div className="bg-slate-700 rounded p-2">
              <div className="text-slate-400">体素大小</div>
              <div className="text-white font-mono">
                {cubeData.voxelSize.x.toFixed(2)} Å
              </div>
            </div>
            <div className="bg-slate-700 rounded p-2">
              <div className="text-slate-400">最大值</div>
              <div className="text-cyan-400 font-mono">
                {cubeData.maxValue.toFixed(3)}
              </div>
            </div>
            <div className="bg-slate-700 rounded p-2">
              <div className="text-slate-400">最小值</div>
              <div className="text-red-400 font-mono">
                {cubeData.minValue.toFixed(3)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrbitalControlPanel;
