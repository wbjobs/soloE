import { Peer, Chunk, Resource } from '../types';
import * as CryptoJS from 'crypto-js';

const CHUNK_SIZE = 1024 * 1024;

export function generatePeerId(): string {
  return '-PCDN01-' + Math.random().toString(36).substring(2, 14);
}

export function splitFileIntoChunks(file: File): Promise<ArrayBuffer[]> {
  return new Promise((resolve) => {
    const chunks: ArrayBuffer[] = [];
    const fileReader = new FileReader();
    let offset = 0;

    fileReader.onload = (e) => {
      if (e.target?.result) {
        chunks.push(e.target.result as ArrayBuffer);
        offset += CHUNK_SIZE;
        
        if (offset < file.size) {
          readNextChunk();
        } else {
          resolve(chunks);
        }
      }
    };

    function readNextChunk() {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    }

    readNextChunk();
  });
}

export function calculateChunkHash(chunk: ArrayBuffer): string {
  const wordArray = CryptoJS.lib.WordArray.create(chunk as any);
  return CryptoJS.SHA1(wordArray).toString();
}

export function verifyChunk(chunk: ArrayBuffer, expectedHash: string): boolean {
  const actualHash = calculateChunkHash(chunk);
  return actualHash === expectedHash;
}

export function mergeChunks(chunks: ArrayBuffer[], fileName: string): void {
  const blob = new Blob(chunks);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export class P2PDownloader {
  private resource: Resource;
  private peerId: string;
  private chunks: Map<number, ArrayBuffer> = new Map();
  private peers: Map<string, any> = new Map();
  private onProgress: (progress: number, downloaded: number, speed: number) => void;
  private onComplete: () => void;
  private downloadedBytes: number = 0;
  private lastUpdate: number = Date.now();

  constructor(resource: Resource, onProgress: any, onComplete: any) {
    this.resource = resource;
    this.peerId = generatePeerId();
    this.onProgress = onProgress;
    this.onComplete = onComplete;
  }

  async start() {
    for (let i = 0; i < this.resource.chunkCount; i++) {
      try {
        await this.downloadChunk(i);
      } catch (e) {
        console.error(`Failed to download chunk ${i}:`, e);
      }
    }

    if (this.chunks.size === this.resource.chunkCount) {
      const sortedChunks = Array.from({ length: this.resource.chunkCount }, (_, i) => this.chunks.get(i)!);
      mergeChunks(sortedChunks, this.resource.name);
      this.onComplete();
    }
  }

  private async downloadChunk(index: number) {
    const chunkInfo = this.resource.chunks[index];
    const response = await fetch(`/api/resource/${this.resource.id}/chunks`);
    const data = await response.json();
    
    const storagePath = `/storage/${this.resource.id}/${chunkInfo.hash}`;
    const chunkResponse = await fetch(storagePath);
    const chunkData = await chunkResponse.arrayBuffer();
    
    if (verifyChunk(chunkData, chunkInfo.hash)) {
      this.chunks.set(index, chunkData);
      this.updateProgress(chunkInfo.size);
    } else {
      throw new Error('Chunk verification failed');
    }
  }

  private updateProgress(chunkSize: number) {
    this.downloadedBytes += chunkSize;
    const now = Date.now();
    const elapsed = (now - this.lastUpdate) / 1000;
    const speed = elapsed > 0 ? chunkSize / elapsed : 0;
    this.lastUpdate = now;

    const progress = (this.chunks.size / this.resource.chunkCount) * 100;
    this.onProgress(progress, this.chunks.size, speed);
  }

  getDownloadedChunks(): number[] {
    return Array.from(this.chunks.keys());
  }

  destroy() {
    this.chunks.clear();
    this.peers.clear();
  }
}
