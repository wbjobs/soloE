import { useState, useRef } from 'react';
import {
  Upload,
  Square,
  Circle,
  Triangle,
  Palette,
  Zap,
  Download,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { PointCloudParser } from '../lib/PointCloudParser';
import { v4 as uuidv4 } from 'uuid';
import { ColorMode, ClipRegionType } from '../../shared/types';

export const Toolbar = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const {
    settings,
    updateSettings,
    clipRegions,
    addClipRegion,
    removeClipRegion,
    clearClipRegions,
    activeTool,
    setActiveTool,
    setPointCloud,
    setLoading,
    setProgress,
  } = useStore();

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const file = files[0];
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension !== 'las' && extension !== 'ply') {
      alert('Please select a LAS or PLY file');
      return;
    }

    setLoading(true);
    setProgress(0);

    try {
      let result;
      if (extension === 'las') {
        result = await PointCloudParser.parseLAS(file);
      } else {
        result = await PointCloudParser.parsePLY(file);
      }

      setProgress(50);

      setPointCloud({
        id: uuidv4(),
        name: file.name,
        format: extension as 'las' | 'ply',
        totalPoints: result.pointCount,
        bounds: result.bounds,
        hasRGB: !!result.colors,
        hasIntensity: !!result.intensities,
        chunkCount: 1,
        createdAt: new Date().toISOString(),
      });

      setProgress(100);
    } catch (error) {
      console.error('Error parsing point cloud:', error);
      alert('Error parsing point cloud file');
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const colorModes: { value: ColorMode; label: string }[] = [
    { value: 'elevation', label: '高程' },
    { value: 'intensity', label: '强度' },
    { value: 'rgb', label: 'RGB' },
    { value: 'uniform', label: '单色' },
  ];

  const toolTypes: { value: ClipRegionType; icon: React.ReactNode; label: string }[] = [
    { value: 'rectangle', icon: <Square size={18} />, label: '矩形裁剪' },
    { value: 'sphere', icon: <Circle size={18} />, label: '球形裁剪' },
    { value: 'polygon', icon: <Triangle size={18} />, label: '多边形裁剪' },
  ];

  return (
    <div className="h-14 bg-slate-900 border-b border-slate-700 flex items-center px-4 gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".las,.ply"
        onChange={(e) => handleFileSelect(e.target.files)}
        className="hidden"
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
          isDragging
            ? 'bg-cyan-600 text-white'
            : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
        }`}
      >
        <Upload size={18} />
        <span>加载文件</span>
      </button>

      <div className="h-8 w-px bg-slate-700" />

      <div className="flex items-center gap-1">
        {toolTypes.map((tool) => (
          <button
            key={tool.value}
            onClick={() => setActiveTool(activeTool === tool.value ? 'none' : tool.value)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              activeTool === tool.value
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
            }`}
            title={tool.label}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div className="h-8 w-px bg-slate-700" />

      <div className="flex items-center gap-2">
        <Palette size={18} className="text-slate-400" />
        <select
          value={settings.colorMode}
          onChange={(e) => updateSettings({ colorMode: e.target.value as ColorMode })}
          className="bg-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          {colorModes.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>

      <div className="h-8 w-px bg-slate-700" />

      <div className="flex items-center gap-2">
        <Zap size={18} className="text-slate-400" />
        <span className="text-slate-300 text-sm">点大小:</span>
        <input
          type="range"
          min="0.5"
          max="5"
          step="0.1"
          value={settings.pointSize}
          onChange={(e) => updateSettings({ pointSize: parseFloat(e.target.value) })}
          className="w-24 accent-cyan-500"
        />
        <span className="text-slate-300 text-sm w-8">{settings.pointSize.toFixed(1)}</span>
      </div>

      <div className="flex-1" />

      {clipRegions.length > 0 && (
        <>
          <button
            onClick={clearClipRegions}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            <Trash2 size={18} />
            <span>清除裁剪</span>
          </button>
        </>
      )}

      <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
        <Download size={18} />
        <span>导出</span>
      </button>
    </div>
  );
};
