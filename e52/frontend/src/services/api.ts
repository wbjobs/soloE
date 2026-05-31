import { 
  Resource, Peer, Chunk, ChunkAvailability, ReplicationTask, ProbeTask, NetworkStats,
  BandwidthStatus, BandwidthConfig, SpeedHistory, GeoLocation, GeoStats
} from '../types';

const API_BASE = '/api';

export async function uploadFile(file: File): Promise<{ success: boolean; resource: Resource; magnetLink: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/resource`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Upload failed');
  }

  return response.json();
}

export async function getResources(): Promise<Resource[]> {
  const response = await fetch(`${API_BASE}/resource`);
  const data = await response.json();
  return data.resources || [];
}

export async function getResource(id: string): Promise<Resource> {
  const response = await fetch(`${API_BASE}/resource/${id}`);
  return response.json();
}

export async function getChunks(id: string): Promise<{ chunks: Chunk[] }> {
  const response = await fetch(`${API_BASE}/resource/${id}/chunks`);
  return response.json();
}

export async function announceToTracker(infoHash: string, peerId: string): Promise<{ interval: number; peers: Peer[] }> {
  const params = new URLSearchParams({
    info_hash: infoHash,
    peer_id: peerId,
    port: '0',
    uploaded: '0',
    downloaded: '0',
    left: '0',
    event: 'started',
  });

  const response = await fetch(`${API_BASE}/tracker/announce?${params}`);
  return response.json();
}

export async function sendHeartbeat(peerId: string, infoHash: string): Promise<void> {
  await fetch(`${API_BASE}/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ peerId, infoHash }),
  });
}

export function parseMagnetLink(magnet: string): string | null {
  const match = magnet.match(/xt=urn:btih:([a-fA-F0-9]+)/);
  return match ? match[1] : null;
}

export async function getChunkAvailability(resourceId: string): Promise<{ resourceId: string; chunks: ChunkAvailability[]; minReplicas: number; chunkCount: number }> {
  const response = await fetch(`${API_BASE}/redundancy/availability/${resourceId}`);
  return response.json();
}

export async function getAllAvailability(): Promise<{ chunks: ChunkAvailability[] }> {
  const response = await fetch(`${API_BASE}/redundancy/availability`);
  return response.json();
}

export async function getReplicationTasks(): Promise<{ tasks: ReplicationTask[] }> {
  const response = await fetch(`${API_BASE}/redundancy/tasks`);
  return response.json();
}

export async function triggerReplication(chunkHash: string, resourceId: string): Promise<void> {
  await fetch(`${API_BASE}/redundancy/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chunkHash, resourceId }),
  });
}

export async function getDHTNodes(): Promise<{ nodes: any[]; count: number }> {
  const response = await fetch(`${API_BASE}/dht/nodes`);
  return response.json();
}

export async function getActiveProbes(): Promise<{ probes: ProbeTask[]; count: number }> {
  const response = await fetch(`${API_BASE}/probe/active`);
  return response.json();
}

export async function triggerProbe(infoHash: string, resourceId: string): Promise<void> {
  await fetch(`${API_BASE}/probe/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ infoHash, resourceId }),
  });
}

export async function getNetworkStats(): Promise<NetworkStats> {
  const response = await fetch(`${API_BASE}/network/stats`);
  return response.json();
}

export async function getBandwidthStatus(): Promise<BandwidthStatus> {
  const response = await fetch(`${API_BASE}/bandwidth/status`);
  return response.json();
}

export async function updateBandwidthConfig(config: BandwidthConfig): Promise<void> {
  await fetch(`${API_BASE}/bandwidth/config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
}

export async function getSpeedHistory(): Promise<SpeedHistory> {
  const response = await fetch(`${API_BASE}/bandwidth/history`);
  return response.json();
}

export async function getGeoLocation(ip?: string): Promise<GeoLocation> {
  const url = ip ? `${API_BASE}/geo/location?ip=${ip}` : `${API_BASE}/geo/location`;
  const response = await fetch(url);
  return response.json();
}

export async function getGeoStats(peerCount?: number): Promise<GeoStats> {
  const url = peerCount ? `${API_BASE}/geo/stats?peers=${peerCount}` : `${API_BASE}/geo/stats`;
  const response = await fetch(url);
  return response.json();
}
