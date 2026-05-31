import { io } from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

class WebRTCService {
  constructor() {
    this.socket = null;
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.producers = new Map();
    this.consumers = new Map();
    this.localStream = null;
    this.remoteStreams = new Map();
    this.peers = new Map();
    this.rtpCapabilities = null;
    this.roomId = null;
    this.peerName = null;
    this.connected = false;
    
    this.bitrateMonitor = {
      history: [],
      currentBitrate: 1000000,
      lastAdjustment: 0,
      estimatedAvailableBitrate: 1500000,
      bitrateHistory: []
    };

    this.networkMonitor = {
      lastConnectionType: null,
      connectionStability: 1.0,
      consecutiveLowScores: 0,
      consecutiveHighScores: 0
    };

    this.statsInterval = null;
    this.eventHandlers = {};
    
    this.speakerDetection = {
      enabled: false,
      volumeThreshold: 0.15,
      minSpeechDuration: 5000,
      speakingStartTimes: new Map(),
      currentSpeaker: null,
      lastSpeakerChange: 0,
      silenceTimeout: 2000,
      lastSpeechTime: 0
    };

    this.audioAnalyzers = new Map();
    this.speakerDetectionInterval = null;
  }

  async init() {
    this.socket = io('https://localhost:3001', {
      rejectUnauthorized: false
    });

    return new Promise((resolve, reject) => {
      this.socket.on('connect', () => {
        console.log('Socket connected');
        this.connected = true;
        this.setupSocketListeners();
        resolve();
      });
      
      this.socket.on('connect_error', (error) => {
        console.error('Socket connect error:', error);
        reject(error);
      });
    });
  }

  setupSocketListeners() {
    this.socket.on('peer-joined', (peer) => {
      console.log('Peer joined:', peer);
      this.peers.set(peer.id, peer);
      this.emit('peer-joined', peer);
    });

    this.socket.on('peer-left', ({ peerId }) => {
      console.log('Peer left:', peerId);
      this.peers.delete(peerId);
      const stream = this.remoteStreams.get(peerId);
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        this.remoteStreams.delete(peerId);
      }
      this.emit('peer-left', peerId);
    });

    this.socket.on('new-producer', async ({ peerId, producerId, kind }) => {
      console.log('New producer:', peerId, producerId, kind);
      if (!this.peers.has(peerId)) {
        this.peers.set(peerId, { id: peerId, producers: [] });
      }
      const peer = this.peers.get(peerId);
      if (!peer.producers) peer.producers = [];
      peer.producers.push({ id: producerId, kind });
      
      await this.consume(producerId);
    });

    this.socket.on('producer-closed', ({ peerId, producerId }) => {
      console.log('Producer closed:', peerId, producerId);
      const consumer = Array.from(this.consumers.values()).find(c => c.producerId === producerId);
      if (consumer) {
        consumer.close();
        this.consumers.delete(consumer.id);
      }
    });

    this.socket.on('producer-score', ({ producerId, score }) => {
      this.monitorNetworkQuality(score, producerId);
    });

    this.socket.on('consumer-score', ({ consumerId, score }) => {
      this.monitorNetworkQuality(score, consumerId, true);
    });

    this.socket.on('network-switch-detected', () => {
      console.log('Network switch detected via signaling');
      this.handleNetworkSwitch();
    });

    this.socket.on('bitrate-estimation', ({ bitrate, timestamp }) => {
      this.updateBitrateEstimation(bitrate, timestamp);
    });

    this.socket.on('ice-state-change', ({ state }) => {
      console.log('ICE state changed:', state);
      if (state === 'disconnected' || state === 'failed') {
        this.handleNetworkDegradation();
      }
    });
  }

  setupNetworkInfoListener() {
    if ('connection' in navigator) {
      const networkConnection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      
      if (networkConnection) {
        this.networkMonitor.lastConnectionType = networkConnection.effectiveType;
        
        networkConnection.addEventListener('change', () => {
          const newConnectionType = networkConnection.effectiveType;
          console.log(`Network connection changed: ${this.networkMonitor.lastConnectionType} -> ${newConnectionType}`);
          
          if (this.networkMonitor.lastConnectionType && 
              this.networkMonitor.lastConnectionType !== newConnectionType) {
            this.handleNetworkSwitch();
          }
          
          this.networkMonitor.lastConnectionType = newConnectionType;
        });
      }
    }
  }

  async joinRoom(roomId, peerName) {
    this.roomId = roomId;
    this.peerName = peerName;

    this.setupNetworkInfoListener();

    return new Promise((resolve, reject) => {
      this.socket.emit('join-room', { roomId, peerName }, async (result) => {
        if (result.success) {
          this.rtpCapabilities = result.rtpCapabilities;
          result.peers.forEach(peer => this.peers.set(peer.id, peer));
          
          this.device = new mediasoupClient.Device();
          await this.device.load({ routerRtpCapabilities: this.rtpCapabilities });
          
          await this.createTransports();
          
          resolve({ peers: result.peers });
        } else {
          reject(new Error(result.error));
        }
      });
    });
  }

  async createTransports() {
    await this.createSendTransport();
    await this.createRecvTransport();
  }

  async createSendTransport() {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-send-transport', {}, async (transportInfo) => {
        if (transportInfo.error) {
          reject(new Error(transportInfo.error));
          return;
        }

        this.sendTransport = this.device.createSendTransport(transportInfo);

        this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          this.socket.emit('connect-transport', {
            transportId: this.sendTransport.id,
            dtlsParameters
          }, (result) => {
            if (result.success) callback();
            else errback(result.error);
          });
        });

        this.sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
          this.socket.emit('produce', { kind, rtpParameters }, (result) => {
            if (result.id) callback({ id: result.id });
            else errback(result.error);
          });
        });

        this.sendTransport.on('connectionstatechange', (state) => {
          console.log('Send transport connection state:', state);
          this.socket.emit('transport-state-change', {
            transportId: this.sendTransport.id,
            state
          });
          if (state === 'disconnected' || state === 'failed') {
            this.handleNetworkDegradation();
          }
        });

        resolve();
      });
    });
  }

  async createRecvTransport() {
    return new Promise((resolve, reject) => {
      this.socket.emit('create-recv-transport', {}, async (transportInfo) => {
        if (transportInfo.error) {
          reject(new Error(transportInfo.error));
          return;
        }

        this.recvTransport = this.device.createRecvTransport(transportInfo);

        this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
          this.socket.emit('connect-transport', {
            transportId: this.recvTransport.id,
            dtlsParameters
          }, (result) => {
            if (result.success) callback();
            else errback(result.error);
          });
        });

        this.recvTransport.on('connectionstatechange', (state) => {
          console.log('Recv transport connection state:', state);
          if (state === 'disconnected' || state === 'failed') {
            this.handleNetworkDegradation();
          }
        });

        resolve();
      });
    });
  }

  async getLocalStream(videoEnabled = true, audioEnabled = true) {
    const constraints = {
      audio: audioEnabled && {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: videoEnabled && {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    };

    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    return this.localStream;
  }

  async produce(track) {
    if (!this.sendTransport) {
      throw new Error('Send transport not ready');
    }

    const producer = await this.sendTransport.produce({
      track,
      codecOptions: {
        videoGoogleStartBitrate: 1000
      }
    });

    this.producers.set(producer.id, producer);
    
    producer.on('trackended', () => {
      console.log('Track ended');
    });

    producer.on('transportclose', () => {
      console.log('Transport closed');
    });

    producer.on('score', (score) => {
      this.monitorNetworkQuality(score, producer.id, false);
    });

    if (!this.statsInterval && track.kind === 'video') {
      this.startStatsCollection();
    }

    return producer;
  }

  async consume(producerId) {
    return new Promise((resolve, reject) => {
      this.socket.emit('consume', {
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      }, async (consumerInfo) => {
        if (consumerInfo.error) {
          reject(new Error(consumerInfo.error));
          return;
        }

        const consumer = await this.recvTransport.consume({
          id: consumerInfo.id,
          producerId: consumerInfo.producerId,
          kind: consumerInfo.kind,
          rtpParameters: consumerInfo.rtpParameters
        });

        this.consumers.set(consumer.id, consumer);

        const track = consumer.track;
        const stream = new MediaStream([track]);
        
        const producerPeer = Array.from(this.peers.values()).find(p =>
          p.producers?.some(pr => pr.id === producerId)
        );
        
        if (producerPeer) {
          const peerId = producerPeer.id;
          if (!this.remoteStreams.has(peerId)) {
            this.remoteStreams.set(peerId, new Map());
          }
          this.remoteStreams.get(peerId).set(consumerInfo.kind, stream);
          
          this.emit('new-stream', {
            peerId,
            kind: consumerInfo.kind,
            stream
          });
        }

        this.socket.emit('resume-consumer', { consumerId: consumer.id });
        resolve(consumer);
      });
    });
  }

  startStatsCollection() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.statsInterval = setInterval(() => {
      this.collectAndAnalyzeStats();
    }, 1000);
  }

  async collectAndAnalyzeStats() {
    try {
      const pc = this.sendTransport?.handler?.pc;
      if (!pc) return;

      const stats = await pc.getStats();
      let availableBitrate = 0;
      let targetBitrate = 0;
      let packetsLost = 0;
      let packetsSent = 0;
      let roundTripTime = 0;

      stats.forEach((report) => {
        if (report.type === 'transport') {
          availableBitrate = report.availableOutgoingBitrate || 0;
        }
        
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          targetBitrate = report.targetBitrate || 0;
          packetsLost = report.packetsLost || 0;
          packetsSent = report.packetsSent || 0;
          
          if (report.roundTripTime) {
            roundTripTime = report.roundTripTime;
          }
        }
      });

      if (availableBitrate > 0) {
        this.updateBitrateEstimation(availableBitrate);
      }

      if (packetsSent > 0) {
        const lossRate = packetsLost / (packetsSent + packetsLost);
        this.analyzePacketLoss(lossRate);
      }

      if (roundTripTime > 0) {
        this.analyzeRTT(roundTripTime);
      }
    } catch (e) {
      console.warn('Failed to collect RTC stats:', e);
    }
  }

  updateBitrateEstimation(bitrate, timestamp = Date.now()) {
    this.bitrateMonitor.estimatedAvailableBitrate = bitrate;
    this.bitrateMonitor.bitrateHistory.push({
      time: timestamp,
      bitrate
    });

    if (this.bitrateMonitor.bitrateHistory.length > 30) {
      this.bitrateMonitor.bitrateHistory.shift();
    }

    const recentBitrates = this.bitrateMonitor.bitrateHistory.slice(-5);
    if (recentBitrates.length >= 3) {
      const avgBitrate = recentBitrates.reduce((sum, b) => sum + b.bitrate, 0) / recentBitrates.length;
      const currentBitrate = this.bitrateMonitor.currentBitrate;
      
      if (avgBitrate < currentBitrate * 0.6) {
        console.log('Significant bandwidth drop detected! Triggering quick adaptation');
        this.triggerQuickAdaptation(avgBitrate);
      }
    }
  }

  analyzePacketLoss(lossRate) {
    if (lossRate > 0.1) {
      console.log('High packet loss detected:', lossRate);
      this.networkMonitor.consecutiveLowScores++;
      
      if (this.networkMonitor.consecutiveLowScores >= 3) {
        const newBitrate = Math.max(200000, this.bitrateMonitor.currentBitrate * 0.6);
        this.applyBitrateChange(newBitrate, true);
        this.networkMonitor.consecutiveLowScores = 0;
      }
    } else if (lossRate < 0.01) {
      this.networkMonitor.consecutiveLowScores = 0;
    }
  }

  analyzeRTT(rtt) {
    if (rtt > 500) {
      console.log('High RTT detected:', rtt);
      const newBitrate = Math.max(200000, this.bitrateMonitor.currentBitrate * 0.8);
      this.applyBitrateChange(newBitrate, true);
    }
  }

  monitorNetworkQuality(score, id, isConsumer = false) {
    const now = Date.now();
    const scoreValue = Array.isArray(score) ? score[0]?.score || 0 : score;
    
    this.bitrateMonitor.history.push({
      time: now,
      score: scoreValue,
      id,
      isConsumer
    });

    if (this.bitrateMonitor.history.length > 20) {
      this.bitrateMonitor.history.shift();
    }

    if (scoreValue < 5) {
      this.networkMonitor.consecutiveLowScores++;
      this.networkMonitor.consecutiveHighScores = 0;
    } else if (scoreValue >= 8) {
      this.networkMonitor.consecutiveHighScores++;
      this.networkMonitor.consecutiveLowScores = 0;
    }

    if (this.networkMonitor.consecutiveLowScores >= 3) {
      console.log('Consecutive low scores detected, triggering quick downgrade');
      this.triggerQuickAdaptation(null, true);
      this.networkMonitor.consecutiveLowScores = 0;
    }

    this.adjustBitrateDynamically();
  }

  adjustBitrateDynamically() {
    const now = Date.now();
    if (now - this.bitrateMonitor.lastAdjustment < 1000) return;

    const recentScores = this.bitrateMonitor.history.slice(-5);
    if (recentScores.length < 3) return;

    const avgScore = recentScores.reduce((sum, item) => sum + item.score, 0) / recentScores.length;

    const minBitrate = 200000;
    const maxBitrate = Math.min(
      2500000,
      this.bitrateMonitor.estimatedAvailableBitrate * 0.8
    );
    let newBitrate = this.bitrateMonitor.currentBitrate;

    if (avgScore >= 9) {
      newBitrate = Math.min(maxBitrate, this.bitrateMonitor.currentBitrate * 1.2);
    } else if (avgScore >= 8) {
      newBitrate = Math.min(maxBitrate, this.bitrateMonitor.currentBitrate * 1.1);
    } else if (avgScore >= 7) {
      newBitrate = Math.min(maxBitrate, this.bitrateMonitor.currentBitrate * 1.05);
    } else if (avgScore < 4) {
      newBitrate = Math.max(minBitrate, this.bitrateMonitor.currentBitrate * 0.4);
    } else if (avgScore < 5) {
      newBitrate = Math.max(minBitrate, this.bitrateMonitor.currentBitrate * 0.6);
    } else if (avgScore < 6) {
      newBitrate = Math.max(minBitrate, this.bitrateMonitor.currentBitrate * 0.85);
    }

    const bitrateChangeThreshold = this.bitrateMonitor.currentBitrate * 0.1;
    if (Math.abs(newBitrate - this.bitrateMonitor.currentBitrate) > bitrateChangeThreshold) {
      this.bitrateMonitor.currentBitrate = newBitrate;
      this.bitrateMonitor.lastAdjustment = now;
      this.applyBitrateChange(newBitrate);
    }
  }

  triggerQuickAdaptation(targetBitrate = null, forceDowngrade = false) {
    const now = Date.now();
    const minBitrate = 200000;
    
    let newBitrate;
    if (targetBitrate) {
      newBitrate = Math.max(minBitrate, targetBitrate * 0.8);
    } else if (forceDowngrade) {
      newBitrate = Math.max(minBitrate, this.bitrateMonitor.currentBitrate * 0.3);
    } else {
      newBitrate = Math.max(minBitrate, this.bitrateMonitor.currentBitrate * 0.5);
    }

    console.log('Quick adaptation triggered, new bitrate:', (newBitrate / 1000000).toFixed(2), 'Mbps');
    
    this.bitrateMonitor.currentBitrate = newBitrate;
    this.bitrateMonitor.lastAdjustment = now;
    this.applyBitrateChange(newBitrate, true);
  }

  handleNetworkSwitch() {
    console.log('Network switch detected, performing full reconfiguration');
    
    this.triggerQuickAdaptation(null, true);
    this.bitrateMonitor.history = [];
    this.bitrateMonitor.bitrateHistory = [];
    this.networkMonitor.consecutiveLowScores = 0;
    this.networkMonitor.consecutiveHighScores = 0;

    this.socket.emit('network-switch', {
      peerId: this.socket.id,
      timestamp: Date.now()
    });

    this.emit('network-switch', { timestamp: Date.now() });
  }

  handleNetworkDegradation() {
    console.log('Network degradation detected');
    this.triggerQuickAdaptation(null, true);
    
    setTimeout(() => {
      this.attemptICErestart();
    }, 1000);
  }

  attemptICErestart() {
    if (this.sendTransport) {
      this.socket.emit('ice-restart', {
        transportId: this.sendTransport.id,
        peerId: this.socket.id
      });
    }
  }

  enableSpeakerDetection(enabled = true) {
    this.speakerDetection.enabled = enabled;
    
    if (enabled) {
      this.startSpeakerDetection();
    } else {
      this.stopSpeakerDetection();
    }
  }

  startSpeakerDetection() {
    if (this.speakerDetectionInterval) {
      clearInterval(this.speakerDetectionInterval);
    }

    this.speakerDetectionInterval = setInterval(() => {
      this.analyzeSpeakerActivity();
    }, 100);
  }

  stopSpeakerDetection() {
    if (this.speakerDetectionInterval) {
      clearInterval(this.speakerDetectionInterval);
      this.speakerDetectionInterval = null;
    }
    this.audioAnalyzers.forEach((analyzer) => {
      if (analyzer.context) {
        analyzer.context.close();
      }
    });
    this.audioAnalyzers.clear();
  }

  async setupAudioAnalysis(peerId, stream) {
    if (!this.speakerDetection.enabled) return;

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const mediaStreamSource = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      mediaStreamSource.connect(analyser);

      this.audioAnalyzers.set(peerId, {
        analyser,
        context: audioContext,
        dataArray: new Uint8Array(analyser.frequencyBinCount)
      });

      console.log('Audio analysis setup for peer:', peerId);
    } catch (e) {
      console.warn('Failed to setup audio analysis:', e);
    }
  }

  getAudioVolume(peerId) {
    const analyzer = this.audioAnalyzers.get(peerId);
    if (!analyzer) return 0;

    analyzer.analyser.getByteFrequencyData(analyzer.dataArray);
    
    let sum = 0;
    for (let i = 0; i < analyzer.dataArray.length; i++) {
      sum += analyzer.dataArray[i];
    }
    
    return sum / analyzer.dataArray.length / 255;
  }

  analyzeSpeakerActivity() {
    if (!this.speakerDetection.enabled) return;

    const now = Date.now();
    const activeSpeakers = [];

    if (this.localStream) {
      const localVolume = this.getAudioVolume('local');
      if (localVolume >= this.speakerDetection.volumeThreshold) {
        activeSpeakers.push({ peerId: 'local', volume: localVolume, name: this.peerName });
      }
    }

    this.remoteStreams.forEach((streams, peerId) => {
      if (streams.audio) {
        const volume = this.getAudioVolume(peerId);
        if (volume >= this.speakerDetection.volumeThreshold) {
          const peer = this.peers.get(peerId);
          activeSpeakers.push({ peerId, volume, name: peer?.name || 'Unknown' });
        }
      }
    });

    if (activeSpeakers.length > 0) {
      activeSpeakers.sort((a, b) => b.volume - a.volume);
      const loudest = activeSpeakers[0];

      if (!this.speakerDetection.speakingStartTimes.has(loudest.peerId)) {
        this.speakerDetection.speakingStartTimes.set(loudest.peerId, now);
      }

      const speakingDuration = now - this.speakerDetection.speakingStartTimes.get(loudest.peerId);
      
      if (speakingDuration >= this.speakerDetection.minSpeechDuration) {
        const currentSpeaker = this.speakerDetection.currentSpeaker;
        const canChangeSpeaker = now - this.speakerDetection.lastSpeakerChange > 3000;

        if ((!currentSpeaker || currentSpeaker !== loudest.peerId) && canChangeSpeaker) {
          this.setCurrentSpeaker(loudest.peerId, loudest.name);
        }
      }

      this.speakerDetection.lastSpeechTime = now;
    } else {
      this.speakerDetection.speakingStartTimes.clear();

      if (now - this.speakerDetection.lastSpeechTime > this.speakerDetection.silenceTimeout) {
        if (this.speakerDetection.currentSpeaker) {
          this.clearCurrentSpeaker();
        }
      }
    }
  }

  setCurrentSpeaker(peerId, peerName) {
    this.speakerDetection.currentSpeaker = peerId;
    this.speakerDetection.lastSpeakerChange = Date.now();

    console.log('New active speaker:', peerName || peerId);

    this.socket.emit('speaker-active', {
      peerId,
      peerName,
      roomId: this.roomId
    });

    this.emit('speaker-changed', {
      peerId,
      peerName
    });
  }

  clearCurrentSpeaker() {
    const previousSpeaker = this.speakerDetection.currentSpeaker;
    this.speakerDetection.currentSpeaker = null;

    if (previousSpeaker) {
      console.log('No active speaker anymore');
      this.emit('speaker-changed', {
        peerId: null,
        peerName: null
      });
    }
  }

  setSpeakerPriority(peerId, priorityLevel) {
    this.socket.emit('set-speaker-priority', {
      peerId,
      priorityLevel,
      roomId: this.roomId
    });
  }

  async applyBitrateChange(bitrate, force = false) {
    console.log(`Adjusting bitrate to: ${(bitrate / 1000000).toFixed(2)} Mbps, force:`, force);
    
    this.producers.forEach(async (producer) => {
      if (producer.kind === 'video') {
        try {
          await producer.setMaxBitrate(bitrate);
        } catch (e) {
          console.warn('Failed to set max bitrate:', e);
        }
      }
    });

    this.adaptVideoParameters(bitrate);
  }

  adaptVideoParameters(bitrate) {
    if (!this.localStream) return;
    
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    const capabilities = videoTrack.getCapabilities();
    if (!capabilities) return;

    let targetWidth = 1280;
    let targetHeight = 720;
    let targetFps = 30;

    if (bitrate < 500000) {
      targetWidth = 640;
      targetHeight = 360;
      targetFps = 15;
    } else if (bitrate < 1000000) {
      targetWidth = 854;
      targetHeight = 480;
      targetFps = 24;
    } else if (bitrate < 1800000) {
      targetWidth = 1280;
      targetHeight = 720;
      targetFps = 30;
    } else {
      targetWidth = 1920;
      targetHeight = 1080;
      targetFps = 30;
    }

    const constraints = {
      width: { ideal: Math.min(targetWidth, capabilities.width?.max || 1920) },
      height: { ideal: Math.min(targetHeight, capabilities.height?.max || 1080) },
      frameRate: { ideal: Math.min(targetFps, capabilities.frameRate?.max || 30) }
    };

    videoTrack.applyConstraints(constraints).catch(e => {
      console.warn('Failed to apply video constraints:', e);
    });

    this.emit('quality-changed', {
      bitrate,
      resolution: `${targetWidth}x${targetHeight}`,
      fps: targetFps
    });
  }

  stopProducer(producerId) {
    const producer = this.producers.get(producerId);
    if (producer) {
      producer.close();
      this.producers.delete(producerId);
      this.socket.emit('close-producer', { producerId });
    }
  }

  leaveRoom() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    this.stopSpeakerDetection();

    this.producers.forEach(producer => producer.close());
    this.consumers.forEach(consumer => consumer.close());
    
    if (this.sendTransport) this.sendTransport.close();
    if (this.recvTransport) this.recvTransport.close();
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }

    this.producers.clear();
    this.consumers.clear();
    this.remoteStreams.clear();
    this.peers.clear();
    
    this.socket.disconnect();
  }

  emit(event, data) {
    if (this.eventHandlers && this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => handler(data));
    }
  }

  on(event, handler) {
    if (!this.eventHandlers) this.eventHandlers = {};
    if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
    this.eventHandlers[event].push(handler);
  }
}

export default new WebRTCService();