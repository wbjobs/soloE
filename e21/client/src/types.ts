export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export type FileTransferStatus = 'pending' | 'transferring' | 'completed' | 'error';

export interface FileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: number;
  status: FileTransferStatus;
  direction: 'send' | 'receive';
}

export interface FileMessage {
  type: 'file-info' | 'file-chunk' | 'file-complete';
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  chunkIndex?: number;
  totalChunks?: number;
  data?: ArrayBuffer;
  transferId?: string;
  encryptedKey?: string;
  iv?: string;
  authTag?: string;
}
