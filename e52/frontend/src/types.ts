export interface Resource {
  id: string;
  name: string;
  size: number;
  chunkCount: number;
  chunkSize: number;
  infoHash: string;
  magnetLink: string;
  chunks: Chunk[];
  createdAt: string;
  downloadCount: number;
  seeders: number;
  leechers: number;
  hotScore: number;
}

export interface Chunk {
  index: number;
  hash: string;
  size: number;
}

export interface Peer {
  id: string;
  infoHash: string;
  ip: string;
  port: number;
  isSeeder: boolean;
  lastSeen: string;
  downloaded: number;
  uploaded: number;
}

export interface DownloadState {
  resource: Resource | null;
  progress: number;
  downloadedChunks: number[];
  peers: Peer[];
  speed: number;
  status: 'idle' | 'downloading' | 'completed' | 'error';
}

export interface ChunkAvailability {
  chunkHash: string;
  resourceId: string;
  peerIds: string[];
  replicaCount: number;
  downloadCount: number;
  lastRequested: string;
  isHot: boolean;
  priorityScore: number;
}

export interface ReplicationTask {
  chunkHash: string;
  resourceId: string;
  fromPeer: string;
  toPeers: string[];
  status: string;
  createdAt: string;
  completedAt?: string;
}

export interface ProbeTask {
  infoHash: string;
  resourceId: string;
  attempts: number;
  lastAttempt: string;
  status: string;
  peersFound: string[];
  startedAt: string;
}

export interface NetworkStats {
  nodeCount: number;
  totalChunksTracked: number;
  lowAvailabilityChunks: number;
  hotChunks: number;
  activeProbes: number;
  minReplicas: number;
}

export interface GeoLocation {
  country: string;
  countryCode: string;
  region: string;
  city: string;
  latitude: number;
  longitude: number;
  isp: string;
  timezone: string;
}

export interface BandwidthConfig {
  enabled: boolean;
  uploadLimitKBps: number;
  downloadLimitKBps: number;
}

export interface BandwidthStatus {
  config: BandwidthConfig;
  currentUploadSpeedBps: number;
  currentDownloadSpeedBps: number;
  totalUploaded: number;
  totalDownloaded: number;
}

export interface SpeedSample {
  timestamp: number;
  speedKBps: number;
  timeStr: string;
}

export interface SpeedHistory {
  upload: SpeedSample[];
  download: SpeedSample[];
}

export interface GeoStats {
  byCountry: Record<string, number>;
  byRegion: Record<string, number>;
  totalPeers: number;
}
