import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { CSRMatrix } from '../types';
import { convertToDense } from '../utils/matrix';

interface MatrixHeatmapProps {
  matrix: CSRMatrix | Float64Array;
  rows: number;
  cols: number;
  title?: string;
  maxSize?: number;
}

const colormaps: Record<string, (t: number) => string> = {
  viridis: (t: number) => {
    const colors = [
      [0.267004, 0.004874, 0.329415],
      [0.282623, 0.140926, 0.457517],
      [0.253935, 0.265254, 0.529983],
      [0.206756, 0.371758, 0.553117],
      [0.163625, 0.471133, 0.558148],
      [0.127568, 0.566949, 0.550556],
      [0.134692, 0.658636, 0.517649],
      [0.266941, 0.752558, 0.440666],
      [0.477504, 0.821444, 0.318195],
      [0.741388, 0.873449, 0.150381],
      [0.993248, 0.906157, 0.143936],
    ];
    const idx = t * (colors.length - 1);
    const i = Math.floor(idx);
    const f = idx - i;
    const c1 = colors[i];
    const c2 = colors[Math.min(i + 1, colors.length - 1)];
    const r = Math.round((c1[0] + f * (c2[0] - c1[0])) * 255);
    const g = Math.round((c1[1] + f * (c2[1] - c1[1])) * 255);
    const b = Math.round((c1[2] + f * (c2[2] - c1[2])) * 255);
    return `rgb(${r},${g},${b})`;
  },
  magma: (t: number) => {
    const r = Math.round((1 - Math.pow(1 - t, 2)) * 255);
    const g = Math.round(t * 100);
    const b = Math.round(Math.pow(t, 0.5) * 200);
    return `rgb(${r},${g},${b})`;
  },
  plasma: (t: number) => {
    const r = Math.round(t * 255);
    const g = Math.round(Math.sin(t * Math.PI) * 150 + 50);
    const b = Math.round((1 - t) * 200);
    return `rgb(${r},${g},${b})`;
  },
};

export const MatrixHeatmap: React.FC<MatrixHeatmapProps> = ({
  matrix,
  rows,
  cols,
  title,
  maxSize = 400,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [colormap, setColormap] = useState<'viridis' | 'magma' | 'plasma'>('viridis');
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number; value: number } | null>(null);

  const denseData = useMemo(() => {
    if (matrix instanceof Float64Array) {
      return matrix;
    }
    return convertToDense(matrix);
  }, [matrix]);

  const { min, max } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < denseData.length; i++) {
      if (Math.abs(denseData[i]) < 1e-10) continue;
      min = Math.min(min, denseData[i]);
      max = Math.max(max, denseData[i]);
    }
    return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 1 : max };
  }, [denseData]);

  const displayRows = Math.min(rows, 100);
  const displayCols = Math.min(cols, 100);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellSize = Math.floor(maxSize / Math.max(displayRows, displayCols));
    const width = displayCols * cellSize;
    const height = displayRows * cellSize;

    canvas.width = width;
    canvas.height = height;

    const rowScale = rows / displayRows;
    const colScale = cols / displayCols;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < displayRows; i++) {
      for (let j = 0; j < displayCols; j++) {
        const srcRow = Math.floor(i * rowScale);
        const srcCol = Math.floor(j * colScale);
        let value = denseData[srcRow * cols + srcCol];

        if (Math.abs(value) < 1e-10) {
          for (let dy = 0; dy < cellSize; dy++) {
            for (let dx = 0; dx < cellSize; dx++) {
              const px = (i * cellSize + dy) * width * 4 + (j * cellSize + dx) * 4;
              data[px] = 15;
              data[px + 1] = 23;
              data[px + 2] = 42;
              data[px + 3] = 255;
            }
          }
          continue;
        }

        const normalized = max === min ? 0.5 : (value - min) / (max - min);
        const colorStr = colormaps[colormap](normalized);
        const rgbMatch = colorStr.match(/rgb\((\d+),(\d+),(\d+)\)/);
        if (!rgbMatch) continue;

        const r = parseInt(rgbMatch[1]);
        const g = parseInt(rgbMatch[2]);
        const b = parseInt(rgbMatch[3]);

        for (let dy = 0; dy < cellSize; dy++) {
          for (let dx = 0; dx < cellSize; dx++) {
            const px = (i * cellSize + dy) * width * 4 + (j * cellSize + dx) * 4;
            data[px] = r;
            data[px + 1] = g;
            data[px + 2] = b;
            data[px + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [denseData, rows, cols, displayRows, displayCols, maxSize, colormap, min, max]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const cellSize = Math.floor(maxSize / Math.max(displayRows, displayCols));
    const row = Math.floor(y / cellSize);
    const col = Math.floor(x / cellSize);

    if (row >= 0 && row < displayRows && col >= 0 && col < displayCols) {
      const srcRow = Math.floor(row * (rows / displayRows));
      const srcCol = Math.floor(col * (cols / displayCols));
      const value = denseData[srcRow * cols + srcCol];
      setHoveredCell({ row: srcRow, col: srcCol, value });
    } else {
      setHoveredCell(null);
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
      {title && (
        <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
      )}

      <div className="flex gap-2 mb-3">
        {(['viridis', 'magma', 'plasma'] as const).map((cm) => (
          <button
            key={cm}
            onClick={() => setColormap(cm)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              colormap === cm
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {cm.charAt(0).toUpperCase() + cm.slice(1)}
          </button>
        ))}
      </div>

      <div className="relative inline-block">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredCell(null)}
          className="rounded border border-slate-600 cursor-crosshair"
        />

        {hoveredCell && (
          <div className="absolute top-2 right-2 bg-slate-900 text-white px-3 py-2 rounded text-sm border border-slate-600 shadow-lg">
            <div className="text-slate-400">位置</div>
            <div className="font-mono">({hoveredCell.row}, {hoveredCell.col})</div>
            <div className="text-slate-400 mt-1">值</div>
            <div className="font-mono font-bold text-blue-400">
              {hoveredCell.value.toExponential(4)}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>最小值: {min.toExponential(2)}</span>
          <span>最大值: {max.toExponential(2)}</span>
        </div>
        <div
          className="h-4 rounded"
          style={{
            background: `linear-gradient(to right, ${colormaps[colormap](0)}, ${colormaps[colormap](0.5)}, ${colormaps[colormap](1)})`,
          }}
        />
      </div>

      <div className="mt-3 text-xs text-slate-500">
        显示 {displayRows}×{displayCols} (原始 {rows}×{cols})
      </div>
    </div>
  );
};
