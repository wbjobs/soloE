import { Device } from 'mediasoup-client';
import { io, Socket } from 'socket.io-client';
import { QualityLevel, Participant, NetworkStats } from '../types';

export interface SpeakerInfo {
  speakerId: string | null;
  speakerName: string | null;
  isSpeakerMode: boolean;
}

export class WebRtcClient {
  private socket: Socket;
  private device: Device | null = null;
  private sendTransport: any = null;
  private recvTransport: any = null;
  private videoProducer: any = null;
  private audioProducer: any = null;
  private consumers: Map<string, any> = new Map();
  private localStream: MediaStream | null = null;
  private roomId: string = '';
  private clientName: string = '';
  private currentQualityLevel: QualityLevel = 'medium';
  private onParticipantsChange: ((participants: Participant[]) => void) | null = null;
  private onNetworkStats: ((stats: NetworkStats) => void) | null = null;
  private onSpeakerChanged: ((speaker: SpeakerInfo) => void) | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private audioContext: AudioContext | null = null;
  private audioAnalyser: AnalyserNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private volumeMonitorInterval: NodeJS.Timeout | null = null;

  private qualityBitrates = {
    low: { min: 200000, max: 300000 },
    medium: { min: 600000, max: 800000 },
    high: { min: 1200000, max: 1500000 }
  };

  constructor() {
    this.socket = io('http://localhost:3001', {
      transports: ['websocket']
    });

    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    this.socket.on('newParticipantJoined', async ({ clientId, clientName }) => {
      console.log('New participant joined:', clientId, clientName);
    });

    this.socket.on('newProducer', async ({ clientId, producerId, kind }) => {
      console.log('New producer:', clientId, producerId, kind);
      if (this.device && this.recvTransport) {
        await this.consume(producerId, clientId);
      }
    });

    this.socket.on('participantLeft', ({ clientId }) => {
      console.log('Participant left:', clientId);
      this.removeConsumerByClientId(clientId);
      this.notifyParticipantsChange();
    });

    this.socket.on('speakerChanged', (speakerInfo) => {
      console.log('Speaker changed:', speakerInfo);
      if (this.onSpeakerChanged) {
        this.onSpeakerChanged(speakerInfo);
      }
    });
  }

  async joinRoom(roomId: string, clientName: string): Promise<boolean> {
    this.roomId = roomId;
    this.clientName = clientName;

    return new Promise((resolve) => {
      this.socket.emit('joinRoom', { roomId, clientName }, async (response: any) => {
        if (response.error) {
          console.error('Join room error:', response.error);
          resolve(false);
          return;
        }

        try {
          this.device = new Device();
          await this.device.load({ routerRtpCapabilities: response.routerRtpCapabilities });

          await this.createTransports();

          for (const participant of response.participants) {
            if (participant.id !== this.socket.id) {
              for (const producer of participant.producers || []) {
                await this.consume(producer.id, participant.id);
              }
            }
          }

          this.startStatsMonitoring();
          resolve(true);
        } catch (error) {
          console.error('Join room error:', error);
          resolve(false);
        }
      });
    });
  }

  private async createTransports() {
    await new Promise((resolve) => {
      this.socket.emit('createWebRtcTransport', { direction: 'send' }, async (response: any) => {
        this.sendTransport = this.device!.createSendTransport(response.transport);
        this.setupTransportListeners(this.sendTransport, 'send');
        resolve(null);
      });
    });

    await new Promise((resolve) => {
      this.socket.emit('createWebRtcTransport', { direction: 'recv' }, async (response: any) => {
        this.recvTransport = this.device!.createRecvTransport(response.transport);
        this.setupTransportListeners(this.recvTransport, 'recv');
        resolve(null);
      });
    });
  }

  private setupTransportListeners(transport: any, direction: string) {
    transport.on('connect', ({ dtlsParameters }: any, callback: any, errback: any) => {
      this.socket.emit('connectTransport', { transportId: transport.id, dtlsParameters, direction }, (response: any) => {
        if (response.error) {
          errback(response.error);
        } else {
          callback();
        }
      });
    });

    transport.on('produce', ({ kind, rtpParameters }: any, callback: any, errback: any) => {
      this.socket.emit('produce', { transportId: transport.id, kind, rtpParameters }, (response: any) => {
        if (response.error) {
          errback(response.error);
        } else {
          callback({ id: response.producerId });
        }
      });
    });
  }

  async startLocalVideo(): Promise<MediaStream | null> {
    try {
      const constraints = this.getMediaConstraints();
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        this.videoProducer = await this.sendTransport.produce({
          track: videoTrack,
          encodings: this.getVideoEncodings()
        });
      }

      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        this.audioProducer = await this.sendTransport.produce({ track: audioTrack });
        this.startVolumeMonitoring(this.localStream);
      }

      return this.localStream;
    } catch (error) {
      console.error('Start local video error:', error);
      return null;
    }
  }

  private startVolumeMonitoring(stream: MediaStream) {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.audioAnalyser = this.audioContext.createAnalyser();
      this.audioSource = this.audioContext.createMediaStreamSource(stream);
      this.audioSource.connect(this.audioAnalyser);
      
      this.audioAnalyser.fftSize = 256;
      const bufferLength = this.audioAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      this.volumeMonitorInterval = setInterval(() => {
        if (!this.audioAnalyser) return;
        
        this.audioAnalyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalizedVolume = Math.min(average / 128, 1);
        
        this.socket.emit('audioVolume', { volume: normalizedVolume });
      }, 200);
    } catch (error) {
      console.error('Error starting volume monitoring:', error);
    }
  }

  private stopVolumeMonitoring() {
    if (this.volumeMonitorInterval) {
      clearInterval(this.volumeMonitorInterval);
      this.volumeMonitorInterval = null;
    }
    
    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }
    
    if (this.audioAnalyser) {
      this.audioAnalyser.disconnect();
      this.audioAnalyser = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  private getMediaConstraints(): MediaStreamConstraints {
    return {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: true
    };
  }

  private getVideoEncodings() {
    const bitrates = this.qualityBitrates[this.currentQualityLevel];
    return [
      {
        rid: 'r0',
        maxBitrate: bitrates.min,
        scaleResolutionDownBy: 4
      },
      {
        rid: 'r1',
        maxBitrate: bitrates.max / 2,
        scaleResolutionDownBy: 2
      },
      {
        rid: 'r2',
        maxBitrate: bitrates.max,
        scaleResolutionDownBy: 1
      }
    ];
  }

  async setQualityLevel(level: QualityLevel) {
    if (this.currentQualityLevel === level) return;

    this.currentQualityLevel = level;

    if (this.videoProducer) {
      const bitrates = this.qualityBitrates[level];
      await this.videoProducer.setMaxBitrate(bitrates.max);

      this.socket.emit('setProducerBitrate', {
        producerId: this.videoProducer.id,
        bitrate: bitrates.max
      });
    }
  }

  getQualityLevel(): QualityLevel {
    return this.currentQualityLevel;
  }

  private async consume(producerId: string, clientId: string) {
    return new Promise((resolve) => {
      this.socket.emit('consume', { producerId, rtpCapabilities: this.device!.rtpCapabilities }, async (response: any) => {
        if (response.error) {
          console.error('Consume error:', response.error);
          resolve(null);
          return;
        }

        const consumer = await this.recvTransport.consume({
          id: response.consumer.id,
          producerId: response.consumer.producerId,
          kind: response.consumer.kind,
          rtpParameters: response.consumer.rtpParameters
        });

        this.consumers.set(response.consumer.id, {
          consumer,
          clientId,
          kind: response.consumer.kind
        });

        this.notifyParticipantsChange();
        resolve(consumer);
      });
    });
  }

  private removeConsumerByClientId(clientId: string) {
    for (const [consumerId, data] of this.consumers) {
      if (data.clientId === clientId) {
        data.consumer.close();
        this.consumers.delete(consumerId);
      }
    }
  }

  private notifyParticipantsChange() {
    if (!this.onParticipantsChange) return;

    const participants: Participant[] = [];

    const clientParticipants = new Map<string, Participant>();

    for (const [, data] of this.consumers) {
      if (!clientParticipants.has(data.clientId)) {
        clientParticipants.set(data.clientId, { id: data.clientId });
      }

      const participant = clientParticipants.get(data.clientId)!;
      if (data.kind === 'video') {
        participant.videoTrack = data.consumer.track;
      } else if (data.kind === 'audio') {
        participant.audioTrack = data.consumer.track;
      }
    }

    participants.push(...clientParticipants.values());
    this.onParticipantsChange(participants);
  }

  private startStatsMonitoring() {
    this.statsInterval = setInterval(async () => {
      if (this.sendTransport) {
        try {
          const stats = await this.sendTransport.getStats();
          const networkStats = this.parseStats(stats);
          
          if (networkStats) {
            this.socket.emit('networkStats', networkStats);
            if (this.onNetworkStats) {
              this.onNetworkStats(networkStats);
            }
          }
        } catch (error) {
        }
      }
    }, 2000);
  }

  private parseStats(stats: any): NetworkStats | null {
    let rtt = 0;
    let packetLoss = 0;
    let bitrate = 0;

    for (const report of stats.values()) {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        rtt = report.currentRoundTripTime * 1000 || 0;
      }

      if (report.type === 'outbound-rtp' && report.kind === 'video') {
        packetLoss = report.packetsLost || 0;
        bitrate = report.bitrate || 0;
      }
    }

    return { rtt, packetLoss, bitrate };
  }

  setOnParticipantsChange(callback: (participants: Participant[]) => void) {
    this.onParticipantsChange = callback;
  }

  setOnNetworkStats(callback: (stats: NetworkStats) => void) {
    this.onNetworkStats = callback;
  }

  setOnSpeakerChanged(callback: (speaker: SpeakerInfo) => void) {
    this.onSpeakerChanged = callback;
  }

  getSocketId(): string {
    return this.socket.id;
  }

  async leaveRoom() {
    this.stopVolumeMonitoring();
    
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.videoProducer) {
      this.videoProducer.close();
      this.videoProducer = null;
    }

    if (this.audioProducer) {
      this.audioProducer.close();
      this.audioProducer = null;
    }

    for (const [, data] of this.consumers) {
      data.consumer.close();
    }
    this.consumers.clear();

    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }

    if (this.recvTransport) {
      this.recvTransport.close();
      this.recvTransport = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.socket.disconnect();
  }

  toggleAudio(enabled: boolean) {
    if (this.audioProducer) {
      if (enabled) {
        this.audioProducer.resume();
      } else {
        this.audioProducer.pause();
      }
    }
  }

  toggleVideo(enabled: boolean) {
    if (this.videoProducer) {
      if (enabled) {
        this.videoProducer.resume();
      } else {
        this.videoProducer.pause();
      }
    }
  }
}
