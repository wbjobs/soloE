import { useState, useCallback } from 'react';

interface FileDropZoneProps {
  onFileSelect: (file: File) => void;
  disabled: boolean;
}

export function FileDropZone({ onFileSelect, disabled }: FileDropZoneProps) {
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
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onFileSelect(files[0]);
    }
  }, [onFileSelect]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFileSelect(files[0]);
    }
  }, [onFileSelect]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300
        ${isDragging ? 'border-primary bg-primary/10 scale-105' : 'border-gray-300'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary hover:bg-gray-50'}
      `}
    >
      <input
        type="file"
        onChange={handleFileChange}
        className="hidden"
        id="file-input"
        disabled={disabled}
      />
      <label htmlFor="file-input" className={disabled ? 'cursor-not-allowed' : 'cursor-pointer'}>
        <div className="text-5xl mb-4">📁</div>
        <p className="text-gray-700 font-medium mb-2">
          {disabled ? '请先连接到对等端' : '拖拽文件到此处'}
        </p>
        <p className="text-gray-500 text-sm">
          或点击选择文件
        </p>
      </label>
    </div>
  );
}
