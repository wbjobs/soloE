import { EventEmitter } from 'events';

export class WebRTCService extends EventEmitter {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private localPeerId: string;

  constructor(localPeerId: string) {
    super();
    this.localPeerId = localPeerId;
  }

  async createOffer(remotePeerId: string): Promise<RTCSessionDescriptionInit> {
    const pc = this.createPeerConnection(remotePeerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(
    remotePeerId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    const pc = this.createPeerConnection(remotePeerId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(remotePeerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peerConnections.get(remotePeerId);
    if (!pc) throw new Error('Peer connection not found');
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async addIceCandidate(remotePeerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peerConnections.get(remotePeerId);
    if (!pc) throw new Error('Peer connection not found');
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  send(remotePeerId: string, data: any): void {
    const dc = this.dataChannels.get(remotePeerId);
    if (!dc || dc.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }
    dc.send(JSON.stringify(data));
  }

  sendBinary(remotePeerId: string, data: ArrayBuffer): void {
    const dc = this.dataChannels.get(remotePeerId);
    if (!dc || dc.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }
    dc.send(data);
  }

  private createPeerConnection(remotePeerId: string): RTCPeerConnection {
    const existingPc = this.peerConnections.get(remotePeerId);
    if (existingPc) return existingPc;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.emit('ice-candidate', remotePeerId, event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      this.emit('connection-state-change', remotePeerId, pc.connectionState);
    };

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      this.setupDataChannel(dc, remotePeerId);
    };

    const dc = pc.createDataChannel('file-transfer', {
      ordered: true,
      maxRetransmits: 3,
    });
    this.setupDataChannel(dc, remotePeerId);

    this.peerConnections.set(remotePeerId, pc);
    return pc;
  }

  private setupDataChannel(dc: RTCDataChannel, remotePeerId: string): void {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      this.dataChannels.set(remotePeerId, dc);
      this.emit('channel-open', remotePeerId);
    };

    dc.onclose = () => {
      this.dataChannels.delete(remotePeerId);
      this.emit('channel-close', remotePeerId);
    };

    dc.onerror = (error) => {
      this.emit('channel-error', remotePeerId, error);
    };

    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          this.emit('message', remotePeerId, message);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      } else {
        this.emit('binary-message', remotePeerId, event.data);
      }
    };
  }

  closeConnection(remotePeerId: string): void {
    const dc = this.dataChannels.get(remotePeerId);
    if (dc) dc.close();
    const pc = this.peerConnections.get(remotePeerId);
    if (pc) pc.close();
    this.dataChannels.delete(remotePeerId);
    this.peerConnections.delete(remotePeerId);
  }

  closeAll(): void {
    this.peerConnections.forEach((_, peerId) => this.closeConnection(peerId));
  }

  isConnected(remotePeerId: string): boolean {
    const dc = this.dataChannels.get(remotePeerId);
    return dc?.readyState === 'open';
  }
}
