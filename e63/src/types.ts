export interface Device {
  id: string;
  name: string;
  address: string;
  port: number;
  last_seen: number;
}

export interface FileInfo {
  file_id: string;
  name: string;
  size: number;
  total_chunks: number;
  chunk_hashes: string[];
}

export interface ChunkData {
  file_id: string;
  index: number;
  data: number[];
  hash: string;
}

export interface TransferSession {
  sessionId: string;
  fileId: string;
  fileName: string;
  peerId: string;
  peerName: string;
  totalChunks: number;
  transferredChunks: number;
  bytesTransferred: number;
  speed: number;
  status: 'transferring' | 'completed' | 'paused' | 'error';
  startTime: number;
  direction: 'send' | 'receive';
}

export interface TransferMessage {
  type: 'offer' | 'answer' | 'candidate' | 'file-info' | 'chunk' | 'chunk-ack' | 'resume-request';
  payload: any;
}

export interface ChunkTransferRecord {
  chunk_index: number;
  start_time: string;
  end_time: string;
  duration_ms: number;
  retry_count: number;
  success: boolean;
  hash: string;
}

export interface TransferReport {
  report_id: string;
  file_id: string;
  file_name: string;
  file_size: number;
  total_chunks: number;
  peer_id: string;
  peer_name: string;
  direction: string;
  start_time: string;
  end_time: string;
  total_duration_ms: number;
  total_bytes_transferred: number;
  average_speed_mbps: number;
  successful_chunks: number;
  failed_chunks: number;
  total_retries: number;
  chunk_records: ChunkTransferRecord[];
  success: boolean;
}

export interface QrCodePayload {
  device_id: string;
  device_name: string;
  address: string;
  port: number;
  session_id: string;
  timestamp: number;
}

export interface SignalingMessage {
  from: string;
  to: string;
  msg_type: string;
  payload: any;
  timestamp: string;
}
