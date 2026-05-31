import { Wifi, WifiOff, ArrowRight } from 'lucide-react';
import type { DeviceInfo } from '../types';
import { getOSIcon } from '../utils/format';

interface DeviceCardProps {
  device: DeviceInfo;
  onSelect: (device: DeviceInfo) => void;
  isSelected?: boolean;
}

export function DeviceCard({ device, onSelect, isSelected }: DeviceCardProps) {
  const isOnline = device.status === 'online';

  return (
    <div
      className={`card p-5 cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-xl ${
        isSelected ? 'ring-2 ring-primary shadow-lg shadow-primary/20' : ''
      }`}
      onClick={() => onSelect(device)}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-14 h-14 rounded-xl bg-dark-600 flex items-center justify-center text-2xl">
          {getOSIcon(device.os)}
        </div>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
          isOnline 
            ? 'bg-green-500/10 text-green-400' 
            : 'bg-dark-500 text-dark-300'
        }`}>
          {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {isOnline ? '在线' : '离线'}
        </div>
      </div>

      <h3 className="text-lg font-semibold text-white mb-1">{device.name}</h3>
      <p className="text-sm text-dark-300 font-mono mb-3">{device.ip}:{device.port}</p>

      <div className="flex items-center justify-between pt-3 border-t border-dark-600">
        <span className="text-xs text-dark-400">
          最后发现: {new Date(device.lastSeen).toLocaleTimeString()}
        </span>
        <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white transition-all">
          <ArrowRight className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
}
