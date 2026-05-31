import { ConnectionStatus } from '../types';

interface StatusIndicatorProps {
  status: ConnectionStatus;
  label: string;
}

export function StatusIndicator({ status, label }: StatusIndicatorProps) {
  const statusColors = {
    disconnected: 'bg-gray-400',
    connecting: 'bg-warning animate-pulse-dot',
    connected: 'bg-success',
  };

  const statusText = {
    disconnected: '未连接',
    connecting: '连接中',
    connected: '已连接',
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${statusColors[status]}`} />
      <span className="text-sm text-gray-600">{label}: {statusText[status]}</span>
    </div>
  );
}
