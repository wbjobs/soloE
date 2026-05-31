export type QualityLevel = 'low' | 'medium' | 'high';

export interface Participant {
  id: string;
  name?: string;
  videoTrack?: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
  producers?: { id: string; kind: string }[];
}

export interface NetworkStats {
  rtt: number;
  packetLoss: number;
  bitrate: number;
}

export interface Consumer {
  id: string;
  producerId: string;
  kind: string;
  track: MediaStreamTrack;
}
