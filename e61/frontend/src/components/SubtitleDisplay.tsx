import React from 'react';
import { Subtitle } from '../types';

interface SubtitleDisplayProps {
  subtitles: Subtitle[];
  currentTime: number;
}

export const SubtitleDisplay: React.FC<SubtitleDisplayProps> = ({
  subtitles,
  currentTime
}) => {
  const currentSubtitle = subtitles.find(
    (sub) => currentTime >= sub.startTime && currentTime <= sub.endTime
  );

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-white font-semibold mb-3">实时字幕</h3>
      <div className="bg-gray-900 rounded p-4 min-h-[80px] flex items-center justify-center">
        {currentSubtitle ? (
          <span className="text-green-400 text-lg text-center">
            {currentSubtitle.text}
          </span>
        ) : (
          <span className="text-gray-500 text-sm">等待语音输入...</span>
        )}
      </div>
      <div className="mt-3 max-h-32 overflow-y-auto space-y-1">
        {subtitles.slice(-5).reverse().map((sub, index) => (
          <div
            key={index}
            className={`text-sm p-2 rounded ${
              sub === currentSubtitle
                ? 'bg-green-900 text-green-300'
                : 'text-gray-400'
            }`}
          >
            {sub.text}
          </div>
        ))}
      </div>
    </div>
  );
};
