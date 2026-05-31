export interface SignalingMessage {
  type: 'offer' | 'answer' | 'candidate' | 'join' | 'leave';
  from: string;
  to: string;
  data: any;
}

export interface DetectionReport {
  id?: number;
  sessionId: string;
  peerId: string;
  timestamp: number;
  jitterScore: number;
  reorderScore: number;
  overallSuspicion: number;
  totalPackets: number;
  reorderedPackets: number;
  avgLatency: number;
  jitter: number;
  details: string;
}

export interface PacketRecord {
  seq: number;
  sendTime: number;
  recvTime: number;
  latency: number;
  size: number;
}

export interface DecodingLog {
  id?: number;
  sessionId: string;
  peerId: string;
  timestamp: number;
  suspicionScore: number;
  decodingSuccess: boolean;
  decodingMethod: string;
  confidence: number;
  bitCount: number;
  byteCount: number;
  encodingType: string;
  hexData: string;
  textData: string;
  rawBits: string;
  details: string;
}

export interface RTCPeer {
  id: string;
  socketId: string;
  roomId: string;
}
