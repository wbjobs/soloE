export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';
  return formatBytes(bytesPerSecond) + '/s';
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function calculateETA(transferred: number, total: number, speed: number): string {
  if (speed === 0 || transferred === 0) return '--';
  const remaining = total - transferred;
  const seconds = remaining / speed;
  return formatDuration(seconds * 1000);
}

export function getFileIcon(type: string): string {
  const ext = type.split('.').pop()?.toLowerCase() || '';
  
  const icons: Record<string, string> = {
    folder: '📁',
    pdf: '📄',
    doc: '📝',
    docx: '📝',
    xls: '📊',
    xlsx: '📊',
    ppt: '📽️',
    pptx: '📽️',
    jpg: '🖼️',
    jpeg: '🖼️',
    png: '🖼️',
    gif: '🖼️',
    mp4: '🎬',
    avi: '🎬',
    mkv: '🎬',
    mp3: '🎵',
    wav: '🎵',
    zip: '📦',
    rar: '📦',
    '7z': '📦',
    exe: '⚙️',
    txt: '📃',
    js: '💛',
    ts: '💙',
    html: '🌐',
    css: '🎨',
    json: '📋',
  };
  
  return icons[ext] || icons[ext] || '📄';
}

export function getOSIcon(os: string): string {
  const icons: Record<string, string> = {
    windows: '🪟',
    macos: '🍎',
    linux: '🐧',
  };
  return icons[os] || '💻';
}
