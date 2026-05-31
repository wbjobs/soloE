export interface PacketRecord {
  seq: number;
  sendTime: number;
  recvTime: number;
  latency: number;
  size: number;
}

export interface BaselineProfile {
  isEstablished: boolean;
  baselinePacketCount: number;
  baselineAvgLatency: number;
  baselineJitter: number;
  baselineJitterStdDev: number;
  baselineReorderRate: number;
  baselineLatencyPercentile95: number;
  createdAt: number | null;
}

export interface DetectionMetrics {
  jitterScore: number;
  reorderScore: number;
  overallSuspicion: number;
  totalPackets: number;
  reorderedPackets: number;
  avgLatency: number;
  jitter: number;
  reorderEntropy: number;
  burstPatternScore: number;
  anomalyPatternScore: number;
  details: string;
  baseline?: BaselineProfile;
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

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'candidate';
  from: string;
  to: string;
  data: any;
}

export interface DecodingResult {
  success: boolean;
  method: string;
  confidence: number;
  rawBits: string;
  bytes: number[];
  hex: string;
  text: string;
  bitCount: number;
  byteCount: number;
  encodingType: string;
  details?: string;
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

export interface WebRTCState {
  peerId: string;
  roomId: string;
  isConnected: boolean;
  isChannelOpen: boolean;
  connectionState: RTCPeerConnectionState | '';
  iceConnectionState: RTCIceConnectionState | '';
  remotePeerId: string | null;
}
