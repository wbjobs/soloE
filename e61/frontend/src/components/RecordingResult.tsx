import React from 'react';
import { Bookmark, Subtitle } from '../types';

interface RecordingResultProps {
  videoUrl: string;
  subtitlesUrl: string;
  bookmarks: Bookmark[];
  subtitles: Subtitle[];
  onClose: () => void;
}

const formatTimeWithMs = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

const getSpeakerColor = (speakerId?: string): string => {
  if (!speakerId) return '#6B7280';
  const colors = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B'];
  const index = parseInt(speakerId.slice(-1), 36) % colors.length;
  return colors[index];
};

export const RecordingResult: React.FC<RecordingResultProps> = ({
  videoUrl,
  subtitlesUrl,
  bookmarks,
  subtitles,
  onClose
}) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">录制完成</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-2xl"
            >
              ×
            </button>
          </div>

          <div className="space-y-6">
            <div>
              <h3 className="text-white font-semibold mb-3">视频预览</h3>
              <video
                src={`http://localhost:3001${videoUrl}`}
                controls
                className="w-full rounded-lg"
              />
            </div>

            <div className="flex gap-4">
              <a
                href={`http://localhost:3001${videoUrl}`}
                download
                className="flex-1 py-3 bg-blue-500 text-white text-center rounded-lg hover:bg-blue-600 transition-colors"
              >
                下载 MP4 视频
              </a>
              <a
                href={`http://localhost:3001${subtitlesUrl}`}
                download
                className="flex-1 py-3 bg-green-500 text-white text-center rounded-lg hover:bg-green-600 transition-colors"
              >
                下载 SRT 字幕
              </a>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-3">书签列表</h3>
              <div className="space-y-2">
                {bookmarks.map((bookmark, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-4 p-3 bg-gray-700 rounded-lg"
                  >
                    <span className="text-yellow-400 font-mono">
                      {formatTimeWithMs(bookmark.time)}
                    </span>
                    <span className="text-gray-200">{bookmark.label}</span>
                  </div>
                ))}
                {bookmarks.length === 0 && (
                  <div className="text-gray-500 text-center py-4">无书签</div>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-3">字幕记录</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {subtitles.map((sub, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-3 bg-gray-700 rounded-lg"
                  >
                    <span className="text-green-400 font-mono text-sm whitespace-nowrap">
                      {formatTimeWithMs(sub.startTime)}
                    </span>
                    {sub.speakerName && (
                      <span
                        className="text-xs px-2 py-1 rounded text-white whitespace-nowrap"
                        style={{ backgroundColor: getSpeakerColor(sub.speakerId) }}
                      >
                        {sub.speakerName}
                      </span>
                    )}
                    <span className="text-gray-200">{sub.text}</span>
                  </div>
                ))}
                {subtitles.length === 0 && (
                  <div className="text-gray-500 text-center py-4">无字幕</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
