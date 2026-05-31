import { useState, useCallback } from 'react';
import { uploadFile } from '../services/api';
import { Resource } from '../types';

export default function Upload() {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resource, setResource] = useState<Resource | null>(null);
  const [magnetLink, setMagnetLink] = useState('');
  const [copied, setCopied] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await handleFileUpload(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await handleFileUpload(e.target.files[0]);
    }
  };

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    setProgress(0);

    try {
      const interval = setInterval(() => {
        setProgress(p => Math.min(p + 5, 95));
      }, 100);

      const result = await uploadFile(file);

      clearInterval(interval);
      setProgress(100);
      setResource(result.resource);
      setMagnetLink(result.magnetLink);

      setTimeout(() => setUploading(false), 500);
    } catch (error) {
      console.error('Upload failed:', error);
      setUploading(false);
    }
  };

  const copyMagnetLink = () => {
    navigator.clipboard.writeText(magnetLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">上传文件</h1>
        <p className="text-gray-400">
          文件将被切分成 1MB 分片，并生成磁力链接供其他用户下载
        </p>
      </div>

      <div
        className={`glass p-12 text-center border-2 border-dashed transition-all ${
          dragActive ? 'border-primary bg-primary/10' : 'border-white/20'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          onChange={handleFileChange}
          className="hidden"
          id="file-upload"
          disabled={uploading}
        />

        {uploading ? (
          <div className="space-y-4">
            <svg className="animate-spin w-16 h-16 mx-auto text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-xl">正在处理文件...</p>
            <div className="progress-bar max-w-md mx-auto">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-gray-400">{progress}%</p>
          </div>
        ) : resource ? (
          <div className="space-y-6">
            <div className="w-20 h-20 bg-gradient-to-br from-success/20 to-success rounded-2xl flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-success mb-2">上传成功！</h3>
              <p className="text-gray-400">{resource.name}</p>
              <p className="text-sm text-gray-500 mt-2">
                {resource.chunkCount} 分片 · SHA-1 校验完成
              </p>
            </div>

            <div className="glass p-4 text-left">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">磁力链接</span>
                <button
                  onClick={copyMagnetLink}
                  className="text-primary hover:text-primary/80 text-sm"
                >
                  {copied ? '已复制！' : '复制'}
                </button>
              </div>
              <p className="text-xs text-gray-500 break-all font-mono bg-black/30 p-3 rounded-lg">
                {magnetLink}
              </p>
            </div>

            <button
              onClick={() => {
                setResource(null);
                setMagnetLink('');
              }}
              className="btn-primary"
            >
              上传另一个文件
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="w-20 h-20 bg-gradient-to-br from-primary/20 to-primary rounded-2xl flex items-center justify-center mx-auto">
              <svg className="w-10 h-10 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="text-xl mb-2">拖拽文件到此处，或</p>
              <label htmlFor="file-upload" className="btn-primary inline-block cursor-pointer">
                选择文件
              </label>
            </div>
            <p className="text-sm text-gray-500">
              支持任意格式文件 · 自动切分 1MB 分片 · SHA-1 完整性校验
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="glass p-4 text-center">
          <div className="text-3xl font-bold text-primary mb-2">1MB</div>
          <p className="text-sm text-gray-400">分片大小</p>
        </div>
        <div className="glass p-4 text-center">
          <div className="text-3xl font-bold text-success mb-2">SHA-1</div>
          <p className="text-sm text-gray-400">哈希校验</p>
        </div>
        <div className="glass p-4 text-center">
          <div className="text-3xl font-bold text-warning mb-2">P2P</div>
          <p className="text-sm text-gray-400">分发协议</p>
        </div>
      </div>
    </div>
  );
}
