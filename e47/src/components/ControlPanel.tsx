import React, { useRef } from 'react';
import { Camera, Image, Download, Play, Pause, Settings, Palette, Users, Eye, EyeOff, CheckSquare, Square } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { getImageData, canvasToBlob, downloadBlob } from '../utils/image';

const INPUT_WIDTH = 192;
const INPUT_HEIGHT = 192;
const OUTPUT_WIDTH = 640;
const OUTPUT_HEIGHT = 480;

interface ControlPanelProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isCameraActive: boolean;
  onToggleCamera: () => void;
  onProcessFrame: (imageData: ImageData) => void;
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  videoRef,
  isCameraActive,
  onToggleCamera,
  onProcessFrame,
  canvasRef,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  
  const {
    inputMode,
    postProcess,
    background,
    setInputMode,
    setPostProcess,
    setBackground,
    updateBackgroundTexture,
    multiPersonEnabled,
    setMultiPersonEnabled,
    personInstances,
    toggleInstanceSelection,
    toggleInstanceVisibility,
    selectAllInstances,
    deselectAllInstances,
    showInstanceBorders,
    setShowInstanceBorders,
    showInstanceColors,
    setShowInstanceColors,
  } = useAppStore();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new window.Image();
    img.src = URL.createObjectURL(file);
    await new Promise((resolve) => {
      img.onload = resolve;
    });

    const imageData = getImageData(img, { width: INPUT_WIDTH, height: INPUT_HEIGHT });
    onProcessFrame(imageData);
  };

  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new window.Image();
    img.src = URL.createObjectURL(file);
    await new Promise((resolve) => {
      img.onload = resolve;
    });

    updateBackgroundTexture(img);
    setBackground({ type: 'image' });
  };

  const handleDownload = async () => {
    if (!canvasRef.current) return;
    
    const blob = await canvasToBlob(canvasRef.current);
    downloadBlob(blob, `portrait-segment-${Date.now()}.png`);
  };

  return (
    <div className="w-80 bg-gray-900 text-white p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center gap-3 pb-4 border-b border-gray-700">
        <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
          <Camera size={24} />
        </div>
        <div>
          <h2 className="text-lg font-bold">人像抠图</h2>
          <p className="text-sm text-gray-400">实时AI背景替换</p>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">输入源</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setInputMode('camera')}
            className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors ${
              inputMode === 'camera'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            <Camera size={18} />
            摄像头
          </button>
          <button
            onClick={() => {
              setInputMode('image');
              fileInputRef.current?.click();
            }}
            className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors ${
              inputMode === 'image'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            <Image size={18} />
            图片
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>

      {inputMode === 'camera' && (
        <div className="space-y-2">
          <button
            onClick={onToggleCamera}
            className={`w-full py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors ${
              isCameraActive
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            {isCameraActive ? <Pause size={20} /> : <Play size={20} />}
            {isCameraActive ? '停止摄像头' : '启动摄像头'}
          </button>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Users size={16} />
          多人像分割
        </h3>
        
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-300">启用多人像模式</span>
          <button
            onClick={() => setMultiPersonEnabled(!multiPersonEnabled)}
            className={`w-12 h-6 rounded-full transition-colors ${
              multiPersonEnabled ? 'bg-blue-500' : 'bg-gray-600'
            }`}
          >
            <div
              className={`w-5 h-5 bg-white rounded-full transition-transform ${
                multiPersonEnabled ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {multiPersonEnabled && (
          <div className="space-y-3 p-3 bg-gray-800 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">显示边框</span>
              <button
                onClick={() => setShowInstanceBorders(!showInstanceBorders)}
                className={`w-10 h-5 rounded-full transition-colors ${
                  showInstanceBorders ? 'bg-blue-500' : 'bg-gray-600'
                }`}
              >
                <div
                  className={`w-4 h-4 bg-white rounded-full transition-transform ${
                    showInstanceBorders ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">显示颜色遮罩</span>
              <button
                onClick={() => setShowInstanceColors(!showInstanceColors)}
                className={`w-10 h-5 rounded-full transition-colors ${
                  showInstanceColors ? 'bg-blue-500' : 'bg-gray-600'
                }`}
              >
                <div
                  className={`w-4 h-4 bg-white rounded-full transition-transform ${
                    showInstanceColors ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {personInstances.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-700">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">检测到 {personInstances.length} 个人物</span>
                  <div className="flex gap-1">
                    <button
                      onClick={selectAllInstances}
                      className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
                    >
                      全选
                    </button>
                    <button
                      onClick={deselectAllInstances}
                      className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
                    >
                      全不选
                    </button>
                  </div>
                </div>
                
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {personInstances.map((instance) => (
                    <div
                      key={instance.trackId}
                      className="flex items-center justify-between p-2 bg-gray-700 rounded"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor: `rgb(${instance.color.r}, ${instance.color.g}, ${instance.color.b})`,
                          }}
                        />
                        <span className="text-sm">
                          人物 #{instance.trackId}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => toggleInstanceSelection(instance.trackId)}
                          className="p-1 hover:bg-gray-600 rounded"
                        >
                          {instance.isSelected ? (
                            <CheckSquare size={16} className="text-green-400" />
                          ) : (
                            <Square size={16} className="text-gray-400" />
                          )}
                        </button>
                        <button
                          onClick={() => toggleInstanceVisibility(instance.trackId)}
                          className="p-1 hover:bg-gray-600 rounded"
                        >
                          {instance.isVisible ? (
                            <Eye size={16} className="text-blue-400" />
                          ) : (
                            <EyeOff size={16} className="text-gray-400" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Palette size={16} />
          背景设置
        </h3>
        
        <div className="flex gap-2">
          <button
            onClick={() => setBackground({ type: 'solid' })}
            className={`flex-1 py-2 px-3 rounded-lg text-sm transition-colors ${
              background.type === 'solid'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            纯色
          </button>
          <button
            onClick={() => setBackground({ type: 'blur' })}
            className={`flex-1 py-2 px-3 rounded-lg text-sm transition-colors ${
              background.type === 'blur'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            模糊
          </button>
          <button
            onClick={() => bgFileInputRef.current?.click()}
            className={`flex-1 py-2 px-3 rounded-lg text-sm transition-colors ${
              background.type === 'image'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            图片
          </button>
        </div>
        <input
          ref={bgFileInputRef}
          type="file"
          accept="image/*"
          onChange={handleBackgroundUpload}
          className="hidden"
        />

        {background.type === 'solid' && (
          <div className="space-y-2">
            <label className="text-sm text-gray-400">背景颜色</label>
            <input
              type="color"
              value={background.color}
              onChange={(e) => setBackground({ color: e.target.value })}
              className="w-full h-10 rounded-lg cursor-pointer bg-gray-700 border-none"
            />
          </div>
        )}

        {background.type === 'blur' && (
          <div className="space-y-2">
            <label className="text-sm text-gray-400">
              模糊程度: {background.blurAmount}
            </label>
            <input
              type="range"
              min="1"
              max="20"
              value={background.blurAmount}
              onChange={(e) => setBackground({ blurAmount: Number(e.target.value) })}
              className="w-full"
            />
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Settings size={16} />
          后处理
        </h3>

        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm text-gray-400">
              边缘羽化: {postProcess.featherAmount}
            </label>
            <input
              type="range"
              min="0"
              max="10"
              value={postProcess.featherAmount}
              onChange={(e) => setPostProcess({ featherAmount: Number(e.target.value) })}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">
              腐蚀: {postProcess.erodeAmount}
            </label>
            <input
              type="range"
              min="0"
              max="5"
              value={postProcess.erodeAmount}
              onChange={(e) => setPostProcess({ erodeAmount: Number(e.target.value) })}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">
              膨胀: {postProcess.dilateAmount}
            </label>
            <input
              type="range"
              min="0"
              max="5"
              value={postProcess.dilateAmount}
              onChange={(e) => setPostProcess({ dilateAmount: Number(e.target.value) })}
              className="w-full"
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleDownload}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center justify-center gap-2 transition-colors"
      >
        <Download size={20} />
        下载图片
      </button>
    </div>
  );
};
