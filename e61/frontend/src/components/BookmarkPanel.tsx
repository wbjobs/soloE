import React, { useState } from 'react';
import { Bookmark } from '../types';

interface BookmarkPanelProps {
  bookmarks: Bookmark[];
  onAddBookmark: (label: string) => void;
  disabled: boolean;
}

export const BookmarkPanel: React.FC<BookmarkPanelProps> = ({
  bookmarks,
  onAddBookmark,
  disabled
}) => {
  const [bookmarkLabel, setBookmarkLabel] = useState('');

  const handleAddBookmark = () => {
    if (bookmarkLabel.trim()) {
      onAddBookmark(bookmarkLabel);
      setBookmarkLabel('');
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-white font-semibold mb-3">书签</h3>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={bookmarkLabel}
          onChange={(e) => setBookmarkLabel(e.target.value)}
          placeholder="书签名称..."
          disabled={disabled}
          className="flex-1 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          onClick={handleAddBookmark}
          disabled={disabled}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          添加
        </button>
      </div>
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {bookmarks.map((bookmark, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-2 bg-gray-700 rounded"
          >
            <span className="text-yellow-400 font-mono text-sm">
              {formatTime(bookmark.time)}
            </span>
            <span className="text-gray-200 text-sm flex-1 ml-3">
              {bookmark.label}
            </span>
          </div>
        ))}
        {bookmarks.length === 0 && (
          <div className="text-gray-500 text-sm text-center py-4">
            暂无书签
          </div>
        )}
      </div>
    </div>
  );
};
