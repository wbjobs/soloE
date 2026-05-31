import { FileInfo } from '../types';

interface FileListProps {
  files: FileInfo[];
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function FileList({ files }: FileListProps) {
  if (files.length === 0) {
    return null;
  }

  const getStatusIcon = (file: FileInfo) => {
    if (file.status === 'completed') {
      return file.direction === 'send' ? '✅' : '📥';
    }
    if (file.status === 'transferring') {
      return file.direction === 'send' ? '📤' : '📥';
    }
    if (file.status === 'error') {
      return '❌';
    }
    return '⏳';
  };

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-700">传输列表</h3>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {files.map((file) => (
          <div
            key={file.id}
            className="bg-gray-50 rounded-lg p-4 border border-gray-200"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-xl">{getStatusIcon(file)}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-800 truncate" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatFileSize(file.size)}
                    {' · '}
                    {file.direction === 'send' ? '发送' : '接收'}
                  </p>
                </div>
              </div>
              <span className="text-sm font-medium text-gray-600 ml-2">
                {file.progress}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  file.status === 'completed'
                    ? 'bg-success'
                    : file.status === 'error'
                    ? 'bg-danger'
                    : 'bg-primary'
                }`}
                style={{ width: `${file.progress}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
