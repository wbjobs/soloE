(function(global) {
  'use strict';

  class P2PCDNSDK {
    constructor(options = {}) {
      this.peerId = this.generatePeerId();
      this.wsUrl = options.wsUrl || 'ws://localhost:3001';
      this.apiUrl = options.apiUrl || 'http://localhost:3000';
      this.ws = null;
      this.connections = new Map();
      this.connectionStates = new Map();
      this.chunks = new Map();
      this.downloadedChunks = new Set();
      this.resourceInfo = null;
      this.chunkSize = options.chunkSize || 1024 * 1024;
      this.listeners = {};
      this.maxPeers = options.maxPeers || 10;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
      
      this.iceGatheringTimeout = options.iceGatheringTimeout || 5000;
      this.connectionTimeout = options.connectionTimeout || 15000;
      this.maxRetries = options.maxRetries || 3;
      this.trickleIce = options.trickleIce !== false;
      
      this.iceServers = options.iceServers || [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ];
      
      this.dataChannels = new Map();
      this.candidateQueues = new Map();
    }

    generatePeerId() {
      return 'peer_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }

    on(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
    }

    emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(callback => callback(data));
      }
    }

    async fetchIceConfig() {
      try {
        const response = await fetch(`${this.apiUrl}/api/ice-config`);
        const data = await response.json();
        if (data.success) {
          this.iceServers = data.iceServers;
          this.iceGatheringTimeout = data.config.iceGatheringTimeout;
          this.connectionTimeout = data.config.connectionTimeout;
          this.maxRetries = data.config.maxRetries;
          console.log('[P2P CDN] ICE config loaded:', this.iceServers.length, 'servers');
        }
      } catch (error) {
        console.warn('[P2P CDN] Failed to fetch ICE config, using defaults');
      }
    }

    async connect() {
      return new Promise(async (resolve, reject) => {
        try {
          await this.fetchIceConfig();
          
          this.ws = new WebSocket(this.wsUrl);
          
          this.ws.onopen = () => {
            console.log('[P2P CDN] WebSocket connected');
            this.reconnectAttempts = 0;
            this.sendToTracker({
              type: 'register',
              peerId: this.peerId
            });
            resolve();
          };

          this.ws.onmessage = (event) => {
            this.handleTrackerMessage(JSON.parse(event.data));
          };

          this.ws.onerror = (error) => {
            console.error('[P2P CDN] WebSocket error:', error);
            reject(error);
          };

          this.ws.onclose = () => {
            console.log('[P2P CDN] WebSocket disconnected');
            this.attemptReconnect();
          };
        } catch (error) {
          reject(error);
        }
      });
    }

    attemptReconnect() {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`[P2P CDN] Attempting reconnect...`, this.reconnectAttempts);
        setTimeout(() => this.connect(), 2000 * this.reconnectAttempts);
      }
    }

    sendToTracker(message) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message));
      }
    }

    handleTrackerMessage(message) {
      switch (message.type) {
        case 'offer':
          this.handleOffer(message);
          break;
        case 'answer':
          this.handleAnswer(message);
          break;
        case 'candidate':
          this.handleCandidate(message);
          break;
        case 'peers':
          this.handlePeerList(message.peers);
          break;
        case 'chunk_schedule':
          this.emit('chunkSchedule', message.schedule);
          break;
        case 'resource_info':
          this.resourceInfo = message.resource;
          this.emit('resourceInfo', message.resource);
          break;
      }
    }

    async handleOffer(message) {
      const fromPeerId = message.fromPeerId;
      
      if (this.connectionStates.has(fromPeerId) && 
          this.connectionStates.get(fromPeerId).state === 'connecting') {
        console.log(`[P2P CDN] Connection already in progress for`, fromPeerId);
        return;
      }

      console.log(`[P2P CDN] Received offer from`, fromPeerId);
      
      const peerConnection = this.createPeerConnection(fromPeerId, false);
      this.connectionStates.set(fromPeerId, {
        state: 'connecting',
        startTime: Date.now(),
        retryCount: 0,
        role: 'answerer',
        candidates: [],
        remoteCandidates: []
      });

      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        await this.waitForIceGatheringComplete(peerConnection, fromPeerId);
        
        this.sendToTracker({
          type: 'answer',
          fromPeerId: this.peerId,
          toPeerId: fromPeerId,
          answer: peerConnection.localDescription,
          candidates: this.connectionStates.get(fromPeerId).candidates
        });

        this.setupConnectionTimeout(peerConnection, fromPeerId);
        
      } catch (error) {
        console.error('[P2P CDN] Error handling offer:', error);
        this.handleConnectionFailure(fromPeerId, 'offer_error');
      }
    }

    async handleAnswer(message) {
      const fromPeerId = message.fromPeerId;
      const peerConnection = this.connections.get(fromPeerId);
      
      if (!peerConnection) {
        console.warn(`[P2P CDN] No connection found for`, fromPeerId);
        return;
      }

      try {
        console.log(`[P2P CDN] Received answer from`, fromPeerId);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
        
        if (message.candidates && message.candidates.length > 0) {
          for (const candidate of message.candidates) {
            if (candidate) {
              await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
          }
          console.log(`[P2P CDN] Added`, message.candidates.length, `remote candidates`);
        }

        if (this.candidateQueues.has(fromPeerId)) {
          const queue = this.candidateQueues.get(fromPeerId);
          for (const candidate of queue) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          }
          this.candidateQueues.delete(fromPeerId);
        }

      } catch (error) {
        console.error('[P2P CDN] Error handling answer:', error);
        this.handleConnectionFailure(fromPeerId, 'answer_error');
      }
    }

    async handleCandidate(message) {
      const fromPeerId = message.fromPeerId;
      const peerConnection = this.connections.get(fromPeerId);
      
      if (!peerConnection || !message.candidate) {
        if (message.candidate) {
          if (!this.candidateQueues.has(fromPeerId)) {
            this.candidateQueues.set(fromPeerId, []);
          }
          this.candidateQueues.get(fromPeerId).push(message.candidate);
        }
        return;
      }

      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
        
        const state = this.connectionStates.get(fromPeerId);
        if (state) {
          state.remoteCandidates.push(message.candidate);
          this.analyzeCandidateQuality(fromPeerId, message.candidate);
        }
        
      } catch (error) {
        console.error('[P2P CDN] Error handling candidate:', error);
      }
    }

    analyzeCandidateQuality(peerId, candidate) {
      if (!candidate || !candidate.type) return;
      
      const state = this.connectionStates.get(peerId);
      if (!state) return;
      
      console.log(`[P2P CDN] Candidate type: ${candidate.type}, protocol: ${candidate.protocol}, priority: ${candidate.priority}`);
      
      if (candidate.type === 'relay') {
        console.log(`[P2P CDN] TURN candidate available - high success probability`);
        state.hasRelay = true;
      } else if (candidate.type === 'srflx') {
        console.log(`[P2P CDN] STUN reflexive candidate available`);
        state.hasSrflx = true;
      }
    }

    handlePeerList(peers) {
      peers.forEach(peerId => {
        if (peerId !== this.peerId && !this.connections.has(peerId)) {
          if (this.connections.size < this.maxPeers) {
            this.connectToPeer(peerId).catch(err => {
              console.warn(`[P2P CDN] Failed to connect to ${peerId}:`, err);
            });
          }
        }
      });
    }

    createPeerConnection(peerId, isInitiator) {
      const config = {
        iceServers: this.iceServers,
        iceTransportPolicy: 'all',
        bundlePolicy: 'balanced',
        rtcpMuxPolicy: 'require'
      };
      
      console.log(`[P2P CDN] Creating ${isInitiator ? 'initiator' : 'answerer'} connection with`, config.iceServers.length, 'ICE servers');
      
      const pc = new RTCPeerConnection(config);
      this.connections.set(peerId, pc);

      const connectionState = {
        state: 'new',
        startTime: Date.now(),
        retryCount: 0,
        role: isInitiator ? 'initiator' : 'answerer',
        candidates: [],
        remoteCandidates: [],
        hasRelay: false,
        hasSrflx: false,
        iceGatheringStartTime: null
      };
      this.connectionStates.set(peerId, connectionState);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          connectionState.candidates.push(event.candidate);
          
          if (this.trickleIce) {
            this.sendToTracker({
              type: 'candidate',
              fromPeerId: this.peerId,
              toPeerId: peerId,
              candidate: event.candidate
            });
          }
        }
      };

      pc.onicegatheringstatechange = () => {
        console.log(`[P2P CDN] ICE gathering state: ${pc.iceGatheringState} for ${peerId}`);
        
        if (pc.iceGatheringState === 'complete') {
          const elapsed = Date.now() - connectionState.iceGatheringStartTime;
          console.log(`[P2P CDN] ICE gathering complete for ${peerId} in ${elapsed}ms`);
          console.log(`[P2P CDN] Collected ${connectionState.candidates.length} candidates`);
          this.analyzeCandidateTypes(connectionState.candidates);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[P2P CDN] ICE connection state: ${pc.iceConnectionState} for ${peerId}`);
        this.handleIceConnectionStateChange(pc, peerId);
      };

      pc.onsignalingstatechange = () => {
        console.log(`[P2P CDN] Signaling state: ${pc.signalingState} for ${peerId}`);
      };

      pc.onconnectionstatechange = () => {
        console.log(`[P2P CDN] Connection state: ${pc.connectionState} for ${peerId}`);
        this.handleConnectionStateChange(pc, peerId);
      };

      pc.ondatachannel = (event) => {
        console.log(`[P2P CDN] Received data channel from ${peerId}`);
        const dataChannel = event.channel;
        this.setupDataChannel(dataChannel, peerId);
      };

      return pc;
    }

    analyzeCandidateTypes(candidates) {
      const types = { host: 0, srflx: 0, relay: 0, prflx: 0 };
      candidates.forEach(c => {
        if (c && types[c.type] !== undefined) {
          types[c.type]++;
        }
      });
      console.log(`[P2P CDN] Candidate types: host=${types.host}, srflx=${types.srflx}, relay=${types.relay}, prflx=${types.prflx}`);
      return types;
    }

    async waitForIceGatheringComplete(pc, peerId, timeout = null) {
      const state = this.connectionStates.get(peerId);
      if (state) {
        state.iceGatheringStartTime = Date.now();
      }
      
      return new Promise((resolve) => {
        const waitTime = timeout || this.iceGatheringTimeout;
        
        if (pc.iceGatheringState === 'complete') {
          resolve();
          return;
        }

        const timeoutId = setTimeout(() => {
          console.log(`[P2P CDN] ICE gathering timeout after ${waitTime}ms, using gathered candidates`);
          resolve();
        }, waitTime);

        pc.addEventListener('icegatheringstatechange', function onComplete() {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeoutId);
            pc.removeEventListener('icegatheringstatechange', onComplete);
            resolve();
          }
        });
      });
    }

    setupConnectionTimeout(pc, peerId) {
      const state = this.connectionStates.get(peerId);
      if (!state) return;
      
      state.connectionTimer = setTimeout(() => {
        if (pc.connectionState !== 'connected' && pc.iceConnectionState !== 'connected') {
          console.warn(`[P2P CDN] Connection timeout for ${peerId} after ${this.connectionTimeout}ms`);
          this.handleConnectionFailure(peerId, 'timeout');
        }
      }, this.connectionTimeout);
    }

    handleIceConnectionStateChange(pc, peerId) {
      const state = pc.iceConnectionState;
      
      switch (state) {
        case 'checking':
          console.log(`[P2P CDN] ICE checking in progress for ${peerId}`);
          break;
        case 'connected':
        case 'completed':
          console.log(`[P2P CDN] ICE connection successful for ${peerId}`);
          const connState = this.connectionStates.get(peerId);
          if (connState && connState.connectionTimer) {
            clearTimeout(connState.connectionTimer);
          }
          break;
        case 'failed':
          console.error(`[P2P CDN] ICE connection failed for ${peerId}`);
          this.handleConnectionFailure(peerId, 'ice_failed');
          break;
        case 'disconnected':
          console.warn(`[P2P CDN] ICE disconnected for ${peerId}, attempting to recover`);
          break;
      }
    }

    handleConnectionStateChange(pc, peerId) {
      const state = pc.connectionState;
      
      switch (state) {
        case 'connected':
          console.log(`[P2P CDN] Connected to peer: ${peerId}`);
          const connState = this.connectionStates.get(peerId);
          if (connState) {
            connState.state = 'connected';
            if (connState.connectionTimer) {
              clearTimeout(connState.connectionTimer);
            }
          }
          this.emit('peerConnected', peerId);
          break;
        case 'failed':
          console.error(`[P2P CDN] Connection failed for ${peerId}`);
          this.handleConnectionFailure(peerId, 'connection_failed');
          break;
        case 'disconnected':
          console.log(`[P2P CDN] Disconnected from peer: ${peerId}`);
          this.connections.delete(peerId);
          this.connectionStates.delete(peerId);
          this.emit('peerDisconnected', peerId);
          break;
      }
    }

    async handleConnectionFailure(peerId, reason) {
      console.warn(`[P2P CDN] Connection failed for ${peerId}: ${reason}`);
      
      const state = this.connectionStates.get(peerId);
      if (!state) return;
      
      if (state.connectionTimer) {
        clearTimeout(state.connectionTimer);
      }
      
      const pc = this.connections.get(peerId);
      if (pc) {
        pc.close();
        this.connections.delete(peerId);
      }
      
      if (state.retryCount < this.maxRetries) {
        state.retryCount++;
        console.log(`[P2P CDN] Retrying connection to ${peerId} (attempt ${state.retryCount}/${this.maxRetries})`);
        
        await this.delay(1000 * state.retryCount);
        
        if (state.role === 'initiator') {
          this.connectToPeer(peerId, state.retryCount).catch(err => {
            console.warn(`[P2P CDN] Retry failed for ${peerId}:`, err);
          });
        }
      } else {
        console.error(`[P2P CDN] Max retries reached for ${peerId}, giving up`);
        this.connectionStates.delete(peerId);
        this.emit('peerConnectionFailed', { peerId, reason });
      }
    }

    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async connectToPeer(peerId, retryCount = 0) {
      if (this.connections.has(peerId)) {
        const existingState = this.connectionStates.get(peerId);
        if (existingState && existingState.state === 'connected') {
          console.log(`[P2P CDN] Already connected to ${peerId}`);
          return;
        }
        if (existingState && existingState.state === 'connecting') {
          console.log(`[P2P CDN] Connection in progress for ${peerId}`);
          return;
        }
      }

      console.log(`[P2P CDN] Initiating connection to ${peerId} (retry ${retryCount})`);
      
      const pc = this.createPeerConnection(peerId, true);
      const state = this.connectionStates.get(peerId);
      state.retryCount = retryCount;
      state.state = 'connecting';

      const dataChannel = pc.createDataChannel('p2p-cdn', {
        ordered: true,
        maxRetransmits: 5
      });
      this.setupDataChannel(dataChannel, peerId);

      try {
        const offer = await pc.createOffer({
          iceRestart: retryCount > 0,
          offerToReceiveAudio: false,
          offerToReceiveVideo: false
        });
        
        await pc.setLocalDescription(offer);
        
        await this.waitForIceGatheringComplete(pc, peerId);
        
        this.sendToTracker({
          type: 'offer',
          fromPeerId: this.peerId,
          toPeerId: peerId,
          offer: pc.localDescription,
          candidates: state.candidates,
          retryCount: retryCount
        });

        this.setupConnectionTimeout(pc, peerId);
        
      } catch (error) {
        console.error('[P2P CDN] Error creating offer:', error);
        this.handleConnectionFailure(peerId, 'offer_error');
      }
    }

    setupDataChannel(dataChannel, peerId) {
      this.dataChannels.set(peerId, dataChannel);

      dataChannel.onopen = () => {
        console.log(`[P2P CDN] Data channel open with ${peerId}`);
        this.emit('dataChannelOpen', peerId);
      };

      dataChannel.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handlePeerMessage(peerId, message);
        } catch (e) {
          console.error('[P2P CDN] Error parsing peer message:', e);
        }
      };

      dataChannel.onerror = (error) => {
        console.error(`[P2P CDN] Data channel error for ${peerId}:`, error);
      };

      dataChannel.onclose = () => {
        console.log(`[P2P CDN] Data channel closed for ${peerId}`);
        this.dataChannels.delete(peerId);
      };
    }

    handlePeerMessage(fromPeerId, message) {
      switch (message.type) {
        case 'chunk_request':
          this.sendChunkToPeer(fromPeerId, message.chunkIndex);
          break;
        case 'chunk_data':
          this.receiveChunk(message.chunkIndex, message.data, message.hash);
          break;
        case 'have':
          this.emit('peerHave', { peerId: fromPeerId, chunks: message.chunks });
          break;
        case 'ping':
          this.sendToPeer(fromPeerId, { type: 'pong', timestamp: message.timestamp });
          break;
        case 'pong':
          const rtt = Date.now() - message.timestamp;
          console.log(`[P2P CDN] RTT to ${fromPeerId}: ${rtt}ms`);
          break;
      }
    }

    sendChunkToPeer(toPeerId, chunkIndex) {
      const chunkData = this.chunks.get(chunkIndex);
      if (chunkData) {
        this.sendToPeer(toPeerId, {
          type: 'chunk_data',
          chunkIndex: chunkIndex,
          data: Array.from(chunkData.data),
          hash: chunkData.hash
        });
      }
    }

    sendToPeer(toPeerId, message) {
      const dataChannel = this.dataChannels.get(toPeerId);
      if (dataChannel && dataChannel.readyState === 'open') {
        try {
          dataChannel.send(JSON.stringify(message));
        } catch (error) {
          console.error(`[P2P CDN] Error sending to ${toPeerId}:`, error);
        }
      }
    }

    async receiveChunk(chunkIndex, data, expectedHash) {
      const actualHash = await this.calculateSHA256(data);
      
      if (actualHash === expectedHash) {
        const uint8Array = new Uint8Array(data);
        this.chunks.set(chunkIndex, {
          data: uint8Array,
          hash: actualHash
        });
        this.downloadedChunks.add(chunkIndex);
        
        this.emit('chunkDownloaded', {
          chunkIndex,
          hash: actualHash,
          size: uint8Array.length
        });

        this.broadcastHave([chunkIndex]);
        this.checkCompletion();
      } else {
        console.error(`[P2P CDN] Hash mismatch for chunk ${chunkIndex}`);
        this.emit('chunkError', { chunkIndex, error: 'Hash mismatch' });
      }
    }

    async calculateSHA256(data) {
      const uint8Data = typeof data === 'string' 
        ? new TextEncoder().encode(data)
        : new Uint8Array(data);
      
      const hashBuffer = await crypto.subtle.digest('SHA-256', uint8Data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    broadcastHave(chunkIndices) {
      const message = {
        type: 'have',
        chunks: chunkIndices
      };
      
      this.dataChannels.forEach((_, peerId) => {
        this.sendToPeer(peerId, message);
      });
      
      this.sendToTracker({
        type: 'have',
        resourceId: this.resourceInfo?.resourceId,
        peerId: this.peerId,
        chunks: chunkIndices
      });
    }

    async downloadResource(resourceId) {
      return new Promise((resolve, reject) => {
        this.sendToTracker({
          type: 'join_resource',
          resourceId,
          peerId: this.peerId
        });

        this.on('resourceInfo', async (resource) => {
          this.resourceInfo = resource;
          this.requestChunks();
        });

        this.on('downloadComplete', (blob) => {
          resolve(blob);
        });
      });
    }

    async requestChunks() {
      if (!this.resourceInfo) return;

      const missingChunks = [];
      for (let i = 0; i < this.resourceInfo.totalChunks; i++) {
        if (!this.downloadedChunks.has(i)) {
          missingChunks.push(i);
        }
      }

      if (missingChunks.length === 0) {
        this.assembleFile();
        return;
      }

      this.sendToTracker({
        type: 'get_schedule',
        resourceId: this.resourceInfo.resourceId,
        peerId: this.peerId,
        downloadedChunks: Array.from(this.downloadedChunks)
      });

      this.on('chunkSchedule', (schedule) => {
        schedule.forEach(item => {
          if (item.peers.length > 0) {
            this.sendToPeer(item.peers[0].peerId, {
              type: 'chunk_request',
              chunkIndex: item.chunkIndex
            });
          }
        });
      });
    }

    checkCompletion() {
      if (!this.resourceInfo) return;
      
      const progress = this.downloadedChunks.size / this.resourceInfo.totalChunks;
      this.emit('progress', {
        downloaded: this.downloadedChunks.size,
        total: this.resourceInfo.totalChunks,
        progress: progress
      });

      if (this.downloadedChunks.size === this.resourceInfo.totalChunks) {
        setTimeout(() => this.assembleFile(), 100);
      }
    }

    assembleFile() {
      if (!this.resourceInfo) return;

      const sortedChunks = [];
      for (let i = 0; i < this.resourceInfo.totalChunks; i++) {
        const chunk = this.chunks.get(i);
        if (chunk) {
          sortedChunks.push(chunk.data);
        }
      }

      const blob = new Blob(sortedChunks, { 
        type: this.resourceInfo.mimeType || 'application/octet-stream'
      });

      this.emit('downloadComplete', blob);
    }

    async downloadFromSource(sourceUrl) {
      const response = await fetch(sourceUrl);
      const reader = response.body.getReader();
      const contentLength = +response.headers.get('Content-Length');
      
      let receivedLength = 0;
      let chunks = [];
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        
        this.emit('sourceProgress', {
          downloaded: receivedLength,
          total: contentLength
        });
      }
      
      const fullData = new Uint8Array(receivedLength);
      let position = 0;
      for (const chunk of chunks) {
        fullData.set(chunk, position);
        position += chunk.length;
      }
      
      const totalChunks = Math.ceil(receivedLength / this.chunkSize);
      for (let i = 0; i < totalChunks; i++) {
        const start = i * this.chunkSize;
        const end = Math.min(start + this.chunkSize, receivedLength);
        const chunkData = fullData.slice(start, end);
        const hash = await this.calculateSHA256(chunkData);
        
        this.chunks.set(i, { data: chunkData, hash });
        this.downloadedChunks.add(i);
      }
      
      this.broadcastHave(Array.from(this.downloadedChunks));
      this.checkCompletion();
    }

    disconnect() {
      if (this.ws) {
        this.ws.close();
      }
      
      this.connectionStates.forEach((state, peerId) => {
        if (state.connectionTimer) {
          clearTimeout(state.connectionTimer);
        }
      });
      
      this.connections.forEach(pc => pc.close());
      this.connections.clear();
      this.dataChannels.clear();
      this.connectionStates.clear();
      this.candidateQueues.clear();
    }

    getStats() {
      const peerStats = [];
      this.connectionStates.forEach((state, peerId) => {
        peerStats.push({
          peerId,
          state: state.state,
          retryCount: state.retryCount,
          hasRelay: state.hasRelay,
          hasSrflx: state.hasSrflx,
          candidateCount: state.candidates.length
        });
      });

      return {
        peerId: this.peerId,
        connectedPeers: Array.from(this.dataChannels.entries())
          .filter(([_, dc]) => dc.readyState === 'open').length,
        connectingPeers: Array.from(this.connectionStates.values())
          .filter(s => s.state === 'connecting').length,
        downloadedChunks: this.downloadedChunks.size,
        totalChunks: this.resourceInfo?.totalChunks || 0,
        iceServers: this.iceServers.length,
        peerStats
      };
    }

    measurePeerRTT(peerId) {
      this.sendToPeer(peerId, {
        type: 'ping',
        timestamp: Date.now()
      });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = P2PCDNSDK;
  } else {
    global.P2PCDNSDK = P2PCDNSDK;
  }

})(typeof window !== 'undefined' ? window : this);
