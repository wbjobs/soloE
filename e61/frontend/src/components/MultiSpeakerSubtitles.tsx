import React from 'react';
import { Subtitle } from '../types';

interface MultiSpeakerSubtitlesProps {
  subtitles: Subtitle[];
  currentTime: number;
}

export const MultiSpeakerSubtitles: React.FC<MultiSpeakerSubtitlesProps> = ({
  subtitles,
  currentTime
}) => {
  const currentSubtitle = subtitles.find(
    (sub) => currentTime >= sub.startTime && currentTime <= sub.endTime
  );

  const recentSubtitles = subtitles.slice(-10).reverse();

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-white font-semibold mb-3">实时字幕</h3>

      <div className="bg-gray-900 rounded-lg p-4 min-h-[100px] flex items-center justify-center mb-4">
        {currentSubtitle ? (
          <div className="text-center">
            {currentSubtitle.speakerName && (
              <span
                className="text-sm font-bold px-2 py-1 rounded"
                style={{
                  backgroundColor: getSpeakerColor(currentSubtitle.speakerId),
                  color: 'white'
                }}
              >
                {currentSubtitle.speakerName}
              </span>
            )}
            <p className="text-green-400 text-lg mt-2">
              {currentSubtitle.text}
            </p>
          </div>
        ) : (
          <span className="text-gray-500 text-sm">等待语音输入...</span>
        )}
      </div>

      <div className="max-h-48 overflow-y-auto space-y-2">
        {recentSubtitles.map((sub, index) => (
          <div
            key={index}
            className={`p-2 rounded ${
              sub === currentSubtitle ? 'bg-green-900 bg-opacity-50' : 'bg-gray-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {sub.speakerName && (
                <span
                  className="text-xs px-2 py-0.5 rounded text-white"
                  style={{ backgroundColor: getSpeakerColor(sub.speakerId) }}
                >
                  {sub.speakerName}
                </span>
              )}
              <span className="text-gray-400 text-xs">
                {formatTime(sub.startTime)}
              </span>
            </div>
            <p className="text-gray-300 text-sm">{sub.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

function getSpeakerColor(speakerId?: string): string {
  if (!speakerId) return '#6B7280';
  const colors = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B'];
  const index = parseInt(speakerId.slice(-1), 36) % colors.length;
  return colors[index];
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
