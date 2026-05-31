import React from 'react';

interface ControlBarProps {
  isRecording: boolean;
  duration: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  disabled: boolean;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  isRecording,
  duration,
  onStartRecording,
  onStopRecording,
  disabled
}) => {
  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-center gap-8">
        <div className="text-center">
          <div className="text-4xl font-mono text-white">
            {formatDuration(duration)}
          </div>
          <div className="text-gray-400 text-sm mt-1">录制时长</div>
        </div>

        <div className="flex gap-4">
          {!isRecording ? (
            <button
              onClick={onStartRecording}
              disabled={disabled}
              className="flex items-center gap-2 px-8 py-4 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-lg font-medium"
            >
              <span className="w-4 h-4 bg-white rounded-full" />
              开始录制
            </button>
          ) : (
            <button
              onClick={onStopRecording}
              className="flex items-center gap-2 px-8 py-4 bg-gray-600 text-white rounded-full hover:bg-gray-700 transition-colors text-lg font-medium"
            >
              <span className="w-4 h-4 bg-white" />
              停止录制
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
