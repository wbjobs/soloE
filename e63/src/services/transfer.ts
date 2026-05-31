import { invoke } from '@tauri-apps/api/core';
import { WebRTCService } from './webrtc';
import { ChunkData, FileInfo, TransferSession } from '../types';

const CHUNK_SIZE = 1024 * 1024;
const MAX_PARALLEL_CHUNKS = 4;
const WINDOW_SIZE = 8;
const MAX_RETRIES = 5;
const RETRY_DELAY_BASE = 200;

interface PendingChunk {
  chunkIndex: number;
  retries: number;
  sentAt: number;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export class TransferService {
  private webrtc: WebRTCService;
  private sessions: Map<string, TransferSession> = new Map();
  private receivedChunks: Map<string, Set<number>> = new Map();
  private pendingChunks: Map<string, Map<number, PendingChunk>> = new Map();
  private sendQueues: Map<string, number[]> = new Map();
  private chunkLocks: Map<string, boolean> = new Map();
  private chunkHashes: Map<string, string[]> = new Map();
  private onProgress: (sessionId: string, chunkIndex: number, bytes: number) => void;
  private onComplete: (sessionId: string) => void;

  constructor(
    localPeerId: string,
    onProgress: (sessionId: string, chunkIndex: number, bytes: number) => void,
    onComplete: (sessionId: string) => void
  ) {
    this.webrtc = new WebRTCService(localPeerId);
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.setupWebRTCListeners();
  }

  private setupWebRTCListeners(): void {
    this.webrtc.on('message', async (peerId: string, message: any) => {
      switch (message.type) {
        case 'file-info':
          await this.handleFileInfo(peerId, message.payload);
          break;
        case 'chunk-request':
          await this.sendChunk(peerId, message.payload.fileId, message.payload.chunkIndex);
          break;
        case 'chunk-ack':
          this.handleChunkAck(peerId, message.payload);
          break;
        case 'resume-request':
          await this.handleResumeRequest(peerId, message.payload);
          break;
        case 'chunk-nack':
          this.handleChunkNack(peerId, message.payload);
          break;
      }
    });

    this.webrtc.on('binary-message', async (peerId: string, data: ArrayBuffer) => {
      await this.handleChunkData(peerId, new Uint8Array(data));
    });
  }

  async startSendSession(
    sessionId: string,
    fileInfo: FileInfo,
    remotePeerId: string,
    remotePeerName: string
  ): Promise<void> {
    const session: TransferSession = {
      sessionId,
      fileId: fileInfo.file_id,
      fileName: fileInfo.name,
      peerId: remotePeerId,
      peerName: remotePeerName,
      totalChunks: fileInfo.total_chunks,
      transferredChunks: 0,
      bytesTransferred: 0,
      speed: 0,
      status: 'transferring',
      startTime: Date.now(),
      direction: 'send',
    };

    this.sessions.set(sessionId, session);
    this.receivedChunks.set(sessionId, new Set());
    this.pendingChunks.set(sessionId, new Map());
    this.sendQueues.set(sessionId, []);
    this.chunkLocks.set(sessionId, false);
    this.chunkHashes.set(sessionId, fileInfo.chunk_hashes);

    this.webrtc.send(remotePeerId, {
      type: 'file-info',
      payload: {
        fileId: fileInfo.file_id,
        fileName: fileInfo.name,
        fileSize: fileInfo.size,
        totalChunks: fileInfo.total_chunks,
        chunkHashes: fileInfo.chunk_hashes,
      },
    });

    const queue: number[] = [];
    for (let i = 0; i < fileInfo.total_chunks; i++) {
      queue.push(i);
    }
    this.sendQueues.set(sessionId, queue);
    this.processSendQueue(sessionId);
  }

  private async processSendQueue(sessionId: string): Promise<void> {
    if (this.chunkLocks.get(sessionId)) return;
    this.chunkLocks.set(sessionId, true);

    try {
      const session = this.sessions.get(sessionId);
      if (!session) return;

      const pending = this.pendingChunks.get(sessionId) || new Map();
      const queue = this.sendQueues.get(sessionId) || [];

      while (pending.size < WINDOW_SIZE && queue.length > 0) {
        const chunkIndex = queue.shift()!;
        await this.sendChunkWithRetry(sessionId, session, chunkIndex);
        await this.delay(50);
      }
    } finally {
      this.chunkLocks.set(sessionId, false);
    }
  }

  private async sendChunkWithRetry(
    sessionId: string,
    session: TransferSession,
    chunkIndex: number
  ): Promise<void> {
    const pending = this.pendingChunks.get(sessionId);
    if (!pending) return;

    if (pending.has(chunkIndex)) {
      const existing = pending.get(chunkIndex)!;
      if (existing.retries >= MAX_RETRIES) {
        console.error(`Chunk ${chunkIndex} exceeded max retries`);
        pending.delete(chunkIndex);
        return;
      }
      existing.retries++;
    } else {
      pending.set(chunkIndex, {
        chunkIndex,
        retries: 0,
        sentAt: Date.now(),
      });
    }

    const pendingChunk = pending.get(chunkIndex)!;
    pendingChunk.sentAt = Date.now();

    if (pendingChunk.timeoutId) {
      clearTimeout(pendingChunk.timeoutId);
    }

    const timeout = RETRY_DELAY_BASE * Math.pow(2, pendingChunk.retries);
    pendingChunk.timeoutId = setTimeout(() => {
      if (pending.has(chunkIndex)) {
        console.log(`Timeout for chunk ${chunkIndex}, retrying...`);
        this.sendChunkWithRetry(sessionId, session, chunkIndex);
      }
    }, timeout);

    try {
      const chunk: ChunkData = await invoke('read_chunk', {
        fileId: session.fileId,
        chunkIndex: chunkIndex,
      });

      const header = new DataView(new ArrayBuffer(12));
      header.setUint32(0, chunkIndex, true);
      header.setUint32(4, chunk.data.length, true);

      const hashBytes = this.hexToBytes(chunk.hash);
      for (let i = 0; i < hashBytes.length && i < 4; i++) {
        header.setUint8(8 + i, hashBytes[i]);
      }

      const combined = new Uint8Array(12 + chunk.data.length);
      combined.set(new Uint8Array(header.buffer), 0);
      combined.set(new Uint8Array(chunk.data), 12);

      if (this.webrtc.isConnected(session.peerId)) {
        this.webrtc.sendBinary(session.peerId, combined.buffer);
      } else {
        console.warn(`WebRTC not connected for peer ${session.peerId}`);
      }
    } catch (error) {
      console.error(`Failed to send chunk ${chunkIndex}:`, error);
    }
  }

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private handleChunkAck(peerId: string, payload: any): void {
    const { fileId, chunkIndex } = payload;
    const sessionId = `${fileId}-${peerId}`;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const received = this.receivedChunks.get(sessionId) || new Set();
    received.add(chunkIndex);
    this.receivedChunks.set(sessionId, received);

    const pending = this.pendingChunks.get(sessionId);
    if (pending && pending.has(chunkIndex)) {
      const pendingChunk = pending.get(chunkIndex)!;
      if (pendingChunk.timeoutId) {
        clearTimeout(pendingChunk.timeoutId);
      }
      pending.delete(chunkIndex);
    }

    session.transferredChunks = received.size;
    session.bytesTransferred = received.size * CHUNK_SIZE;

    const elapsed = (Date.now() - session.startTime) / 1000;
    session.speed = session.bytesTransferred / Math.max(elapsed, 0.1);

    this.onProgress(sessionId, chunkIndex, session.bytesTransferred);

    if (received.size >= session.totalChunks) {
      session.status = 'completed';
      this.onComplete(sessionId);
    } else {
      this.processSendQueue(sessionId);
    }
  }

  private handleChunkNack(peerId: string, payload: any): void {
    const { fileId, chunkIndex } = payload;
    const sessionId = `${fileId}-${peerId}`;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const queue = this.sendQueues.get(sessionId) || [];
    if (!queue.includes(chunkIndex)) {
      queue.unshift(chunkIndex);
      this.sendQueues.set(sessionId, queue);
    }
    this.processSendQueue(sessionId);
  }

  private async handleFileInfo(peerId: string, fileInfo: any): Promise<void> {
    const sessionId = `${fileInfo.fileId}-${peerId}`;
    const session: TransferSession = {
      sessionId,
      fileId: fileInfo.fileId,
      fileName: fileInfo.fileName,
      peerId: peerId,
      peerName: peerId,
      totalChunks: fileInfo.totalChunks,
      transferredChunks: 0,
      bytesTransferred: 0,
      speed: 0,
      status: 'transferring',
      startTime: Date.now(),
      direction: 'receive',
    };

    this.sessions.set(sessionId, session);
    this.receivedChunks.set(sessionId, new Set());
    this.chunkHashes.set(sessionId, fileInfo.chunkHashes);

    await invoke('create_file', {
      fileId: fileInfo.fileId,
      name: fileInfo.fileName,
      size: fileInfo.fileSize,
      totalChunks: fileInfo.totalChunks,
      savePath: '.',
    });

    for (let i = 0; i < Math.min(WINDOW_SIZE, fileInfo.totalChunks); i++) {
      this.webrtc.send(peerId, {
        type: 'chunk-request',
        payload: { fileId: fileInfo.fileId, chunkIndex: i },
      });
    }
  }

  private async sendChunk(peerId: string, fileId: string, chunkIndex: number): Promise<void> {
    const session = Array.from(this.sessions.values()).find(
      (s) => s.fileId === fileId && s.peerId === peerId
    );
    if (!session) {
      console.warn(`Session not found for file ${fileId} and peer ${peerId}`);
      return;
    }
    await this.sendChunkWithRetry(session.sessionId, session, chunkIndex);
  }

  private async handleChunkData(peerId: string, data: Uint8Array): Promise<void> {
    if (data.length < 12) {
      console.warn('Received chunk too small');
      return;
    }

    const header = new DataView(data.buffer.slice(0, 12));
    const chunkIndex = header.getUint32(0, true);
    const dataLength = header.getUint32(4, true);

    const session = Array.from(this.sessions.values()).find(
      (s) => s.peerId === peerId && s.direction === 'receive'
    );

    if (!session) {
      console.warn(`No receive session found for peer ${peerId}`);
      return;
    }

    const received = this.receivedChunks.get(session.sessionId) || new Set();
    if (received.has(chunkIndex)) {
      this.webrtc.send(peerId, {
        type: 'chunk-ack',
        payload: { fileId: session.fileId, chunkIndex },
      });
      return;
    }

    const chunkData = data.slice(12, 12 + dataLength);
    const chunkHashes = this.chunkHashes.get(session.sessionId);
    const expectedHash = chunkHashes ? chunkHashes[chunkIndex] : null;

    if (expectedHash) {
      const actualHash = await this.computeSha256(chunkData);
      if (actualHash !== expectedHash) {
        console.error(`Chunk ${chunkIndex} hash mismatch, requesting retransmit`);
        this.webrtc.send(peerId, {
          type: 'chunk-nack',
          payload: { fileId: session.fileId, chunkIndex },
        });
        return;
      }
    }

    try {
      await invoke('write_chunk', {
        chunk: {
          file_id: session.fileId,
          index: chunkIndex,
          data: Array.from(chunkData),
          hash: expectedHash || '',
        },
      });

      received.add(chunkIndex);
      this.receivedChunks.set(session.sessionId, received);

      session.transferredChunks = received.size;
      session.bytesTransferred = received.size * CHUNK_SIZE;

      const elapsed = (Date.now() - session.startTime) / 1000;
      session.speed = session.bytesTransferred / Math.max(elapsed, 0.1);

      this.onProgress(session.sessionId, chunkIndex, session.bytesTransferred);

      this.webrtc.send(peerId, {
        type: 'chunk-ack',
        payload: { fileId: session.fileId, chunkIndex },
      });

      const nextChunk = chunkIndex + WINDOW_SIZE;
      if (nextChunk < session.totalChunks && !received.has(nextChunk)) {
        this.webrtc.send(peerId, {
          type: 'chunk-request',
          payload: { fileId: session.fileId, chunkIndex: nextChunk },
        });
      }

      if (received.size >= session.totalChunks) {
        const isValid = await invoke('verify_file', {
          fileId: session.fileId,
          chunkHashes: this.chunkHashes.get(session.sessionId) || [],
        });

        if (isValid) {
          session.status = 'completed';
          this.onComplete(session.sessionId);
        } else {
          console.error('Final file verification failed');
          this.requestResume(session.sessionId);
        }
      }
    } catch (error) {
      console.error(`Failed to write chunk ${chunkIndex}:`, error);
      this.webrtc.send(peerId, {
        type: 'chunk-nack',
        payload: { fileId: session.fileId, chunkIndex },
      });
    }
  }

  private async computeSha256(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async handleResumeRequest(peerId: string, payload: any): Promise<void> {
    const { fileId, missingChunks } = payload;
    for (const chunkIndex of missingChunks) {
      await this.sendChunk(peerId, fileId, chunkIndex);
    }
  }

  requestResume(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const received = this.receivedChunks.get(sessionId) || new Set();
    const missingChunks: number[] = [];

    for (let i = 0; i < session.totalChunks; i++) {
      if (!received.has(i)) {
        missingChunks.push(i);
      }
    }

    console.log(`Resuming transfer, requesting ${missingChunks.length} missing chunks`);

    this.webrtc.send(session.peerId, {
      type: 'resume-request',
      payload: { fileId: session.fileId, missingChunks },
    });
  }

  getSession(sessionId: string): TransferSession | undefined {
    return this.sessions.get(sessionId);
  }

  getWebRTCService(): WebRTCService {
    return this.webrtc;
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const pending = this.pendingChunks.get(sessionId);
      if (pending) {
        pending.forEach((chunk) => {
          if (chunk.timeoutId) {
            clearTimeout(chunk.timeoutId);
          }
        });
      }
      this.webrtc.closeConnection(session.peerId);
    }
    this.sessions.delete(sessionId);
    this.receivedChunks.delete(sessionId);
    this.pendingChunks.delete(sessionId);
    this.sendQueues.delete(sessionId);
    this.chunkLocks.delete(sessionId);
    this.chunkHashes.delete(sessionId);
  }

  closeAll(): void {
    this.webrtc.closeAll();
    this.pendingChunks.forEach((pending) => {
      pending.forEach((chunk) => {
        if (chunk.timeoutId) {
          clearTimeout(chunk.timeoutId);
        }
      });
    });
    this.sessions.clear();
    this.receivedChunks.clear();
    this.pendingChunks.clear();
    this.sendQueues.clear();
    this.chunkLocks.clear();
    this.chunkHashes.clear();
  }
}
