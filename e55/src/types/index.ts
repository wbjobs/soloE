export type OSType = 'windows' | 'macos' | 'linux';
export type DeviceStatus = 'online' | 'offline' | 'connecting';
export type TransferDirection = 'send' | 'receive';
export type TransferStatus = 'pending' | 'transferring' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type FileType = 'file' | 'folder';
export type ConnectionMethod = 'broadcast' | 'manual' | 'tcp_hole_punch' | 'signaling_server';

export interface DeviceInfo {
  id: string;
  name: string;
  ip: string;
  port: number;
  os: OSType;
  status: DeviceStatus;
  lastSeen: number;
  connectionMethod?: ConnectionMethod;
  publicIp?: string;
  publicPort?: number;
}

export interface SignalingServerConfig {
  enabled: boolean;
  url: string;
  apiKey?: string;
}

export interface HolePunchAttempt {
  targetIp: string;
  targetPort: number;
  localPort: number;
  status: 'trying' | 'success' | 'failed';
  attempts: number;
}

export interface FileItem {
  id: string;
  name: string;
  path: string;
  size: number;
  type: FileType;
  children?: FileItem[];
}

export interface TransferTask {
  id: string;
  direction: TransferDirection;
  peerDevice: DeviceInfo;
  files: FileItem[];
  totalSize: number;
  transferredSize: number;
  speed: number;
  status: TransferStatus;
  startTime: number;
  endTime?: number;
  error?: string;
}

export interface AppSettings {
  deviceName: string;
  savePath: string;
  autoAccept: boolean;
  maxConcurrentTransfers: number;
  enableEncryption: boolean;
  discoveryPort: number;
  transferPort: number;
  enableHolePunch: boolean;
  holePunchAttempts: number;
  enableSignaling: boolean;
  signalingServerUrl: string;
  signalingApiKey?: string;
}

export interface TransferProgressEvent {
  transferId: string;
  bytesTransferred: number;
  totalBytes: number;
  speed: number;
}

export interface TransferRequestEvent {
  fromDevice: DeviceInfo;
  files: FileItem[];
  transferId: string;
}

export type SyncStatus = 'idle' | 'scanning' | 'syncing' | 'paused' | 'error';
export type SyncMode = 'bidirectional' | 'send_only' | 'receive_only';

export interface SyncSessionConfig {
  session_id: string;
  local_path: string;
  peer_device: DeviceInfo;
  sync_mode: SyncMode;
  chunk_size: number;
  auto_start: boolean;
  ignore_patterns: string[];
}

export interface SyncStats {
  files_synced: number;
  bytes_transferred: number;
  files_to_sync: number;
  bytes_to_sync: number;
  errors: number;
  start_time: number;
  last_sync_time?: number;
}

export interface SyncProgress {
  session_id: string;
  current_file: string;
  progress: number;
  bytes_transferred: number;
  total_bytes: number;
  status: SyncStatus;
}

export interface FileMetadata {
  path: string;
  size: number;
  modified: number;
  hash: string;
  chunk_hashes: string[];
}
