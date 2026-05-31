import { FileInfo } from '../types';

interface FileSelectorProps {
  selectedFile: FileInfo | null;
  onSelectFile: () => void;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

export default function FileSelector({ selectedFile, onSelectFile }: FileSelectorProps) {
  return (
    <div className="card">
      <h2 className="card-title">选择文件</h2>
      <button className="btn btn-primary select-file-btn" onClick={onSelectFile}>
        选择文件
      </button>

      {selectedFile ? (
        <div className="file-info">
          <div className="file-info-name">{selectedFile.name}</div>
          <div className="file-info-details">
            <div>大小: {formatSize(selectedFile.size)}</div>
            <div>分块: {selectedFile.total_chunks} 块 (每块 1MB)</div>
          </div>
        </div>
      ) : (
        <div className="no-file">尚未选择文件</div>
      )}
    </div>
  );
}
