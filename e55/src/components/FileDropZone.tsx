import { useState, useCallback } from 'react';
import { Upload, FolderOpen, X } from 'lucide-react';
import type { FileItem } from '../types';
import { formatBytes, getFileIcon } from '../utils/format';

interface FileDropZoneProps {
  files: FileItem[];
  onFilesChange: (files: FileItem[]) => void;
}

export function FileDropZone({ files, onFilesChange }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    const newFiles: FileItem[] = droppedFiles.map((file, index) => ({
      id: `file-${Date.now()}-${index}`,
      name: file.name,
      path: (file as any).path || file.webkitRelativePath || file.name,
      size: file.size,
      type: file.type === '' && file.size === 0 ? 'folder' : 'file',
    }));

    onFilesChange([...files, ...newFiles]);
  }, [files, onFilesChange]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const newFiles: FileItem[] = selectedFiles.map((file, index) => ({
      id: `file-${Date.now()}-${index}`,
      name: file.name,
      path: (file as any).path || file.name,
      size: file.size,
      type: 'file',
    }));

    onFilesChange([...files, ...newFiles]);
    e.target.value = '';
  }, [files, onFilesChange]);

  const handleRemoveFile = (fileId: string) => {
    onFilesChange(files.filter((f) => f.id !== fileId));
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all ${
          isDragging
            ? 'border-primary bg-primary/5 scale-[1.02]'
            : 'border-dark-500 hover:border-dark-400'
        }`}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-dark-600 flex items-center justify-center">
            <Upload className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="text-white font-medium mb-1">拖拽文件到此处</p>
            <p className="text-sm text-dark-300">或者点击选择文件</p>
          </div>
          <label className="btn btn-primary cursor-pointer flex items-center gap-2">
            <FolderOpen className="w-4 h-4" />
            选择文件
            <input
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </label>
        </div>

        {isDragging && (
          <div className="absolute inset-0 bg-primary/5 rounded-xl pointer-events-none" />
        )}
      </div>

      {files.length > 0 && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-white">已选择 {files.length} 个文件</h4>
            <span className="text-sm text-dark-300">
              总计 {formatBytes(files.reduce((acc, f) => acc + f.size, 0))}
            </span>
          </div>
          
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between p-3 bg-dark-600 rounded-lg hover:bg-dark-500 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">{getFileIcon(file.name)}</span>
                  <div>
                    <p className="text-sm text-white font-medium truncate max-w-[200px]">
                      {file.name}
                    </p>
                    <p className="text-xs text-dark-300">{formatBytes(file.size)}</p>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveFile(file.id)}
                  className="p-1.5 rounded-lg hover:bg-dark-400 text-dark-300 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
