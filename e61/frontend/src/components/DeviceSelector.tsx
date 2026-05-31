import React from 'react';
import { AudioDevice } from '../types';

interface DeviceSelectorProps {
  audioDevices: AudioDevice[];
  selectedAudioDevice: string;
  onAudioDeviceChange: (deviceId: string) => void;
  isRecording?: boolean;
}

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  audioDevices,
  selectedAudioDevice,
  onAudioDeviceChange,
  isRecording = false
}) => {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-white font-semibold mb-3">音频设备选择</h3>
      {isRecording && (
        <div className="mb-3 p-2 bg-yellow-900 bg-opacity-50 rounded border border-yellow-600">
          <span className="text-yellow-400 text-xs">
            ⚠️ 录制过程中切换设备可能导致音视频不同步
          </span>
        </div>
      )}
      <div className="space-y-2">
        {audioDevices.map((device) => (
          <label
            key={device.deviceId}
            className={`flex items-center space-x-3 p-2 rounded transition-colors ${
              isRecording 
                ? 'bg-gray-700 opacity-60 cursor-not-allowed' 
                : 'hover:bg-gray-700 cursor-pointer'
            }`}
          >
            <input
              type="radio"
              name="audioDevice"
              value={device.deviceId}
              checked={selectedAudioDevice === device.deviceId}
              onChange={(e) => !isRecording && onAudioDeviceChange(e.target.value)}
              disabled={isRecording}
              className="w-4 h-4 text-blue-500"
            />
            <span className="text-gray-200 text-sm">
              {device.label || `麦克风 ${device.deviceId.slice(0, 8)}`}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};
