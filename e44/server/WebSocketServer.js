const WebSocket = require('ws');
const PeerManager = require('./services/PeerManager');
const ResourceManager = require('./services/ResourceManager');
const ChunkAvailabilityManager = require('./services/ChunkAvailabilityManager');
const ChunkScheduler = require('./services/ChunkScheduler');
const config = require('./config');

class WebSocketServer {
  constructor(httpServer) {
    this.wss = new WebSocket.Server({ port: config.server.wsPort });
    this.connections = new Map();
    this.resourcePeers = new Map();
    
    this.setupEventHandlers();
    console.log('[P2P CDN] WebSocket server running on port', config.server.wsPort);
  }

  setupEventHandlers() {
    this.wss.on('connection', (ws, request) => {
      const ip = request.socket.remoteAddress;
      const peerId = 'temp_' + Math.random().toString(36).substr(2, 9);
      
      this.connections.set(peerId, { ws, ip, peerId: null });
      
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data);
          await this.handleMessage(peerId, message);
        } catch (error) {
          console.error('[P2P CDN] Error handling message:', error);
        }
      });

      ws.on('close', () => {
        this.handleDisconnect(peerId);
      });

      ws.on('error', (error) => {
        console.error('[P2P CDN] WebSocket error:', error);
      });
    });

    setInterval(() => this.cleanupInactivePeers(), 30000);
  }

  async handleMessage(tempPeerId, message) {
    const connection = this.connections.get(tempPeerId);
    if (!connection) return;

    switch (message.type) {
      case 'register':
        await this.handleRegister(tempPeerId, message, connection);
        break;
      case 'offer':
      case 'answer':
      case 'candidate':
        await this.forwardSignal(message);
        break;
      case 'join_resource':
        await this.handleJoinResource(message);
        break;
      case 'have':
        await this.handleHave(message);
        break;
      case 'get_schedule':
        await this.handleGetSchedule(message);
        break;
    }
  }

  async handleRegister(tempPeerId, message, connection) {
    const peerId = message.peerId;
    connection.peerId = peerId;
    
    await PeerManager.registerPeer(peerId, connection.ip);
    
    this.connections.forEach((conn, id) => {
      if (conn.peerId && conn.peerId !== peerId) {
        this.sendToPeer(conn.peerId, {
          type: 'peer_joined',
          peerId: peerId
        });
      }
    });

    const activePeers = await PeerManager.getActivePeers();
    const peerIds = activePeers.map(p => p.peerId).filter(id => id !== peerId);
    
    this.sendToPeer(peerId, {
      type: 'peers',
      peers: peerIds
    });
  }

  async handleJoinResource(message) {
    const { resourceId, peerId } = message;
    
    const resource = await ResourceManager.getResource(resourceId);
    if (resource) {
      await ResourceManager.addPeerToResource(resourceId, peerId);
      
      if (!this.resourcePeers.has(resourceId)) {
        this.resourcePeers.set(resourceId, new Set());
      }
      this.resourcePeers.get(resourceId).add(peerId);

      this.sendToPeer(peerId, {
        type: 'resource_info',
        resource: resource
      });

      const resourcePeers = this.resourcePeers.get(resourceId);
      const otherPeers = Array.from(resourcePeers).filter(id => id !== peerId);
      
      this.sendToPeer(peerId, {
        type: 'peers',
        peers: otherPeers
      });
    }
  }

  async handleHave(message) {
    const { resourceId, peerId, chunks } = message;
    
    if (resourceId && chunks && chunks.length > 0) {
      await ChunkAvailabilityManager.updatePeerChunks(resourceId, peerId, chunks);
    }
  }

  async handleGetSchedule(message) {
    const { resourceId, peerId, downloadedChunks } = message;
    
    const schedule = await ChunkScheduler.getDownloadSchedule(
      resourceId,
      peerId,
      downloadedChunks || [],
      15
    );
    
    this.sendToPeer(peerId, {
      type: 'chunk_schedule',
      schedule: schedule
    });
  }

  async forwardSignal(message) {
    const toPeerId = message.toPeerId;
    const connection = this.getConnectionByPeerId(toPeerId);
    
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(JSON.stringify(message));
    }
  }

  getConnectionByPeerId(peerId) {
    for (const [_, conn] of this.connections) {
      if (conn.peerId === peerId) {
        return conn;
      }
    }
    return null;
  }

  sendToPeer(peerId, message) {
    const connection = this.getConnectionByPeerId(peerId);
    if (connection && connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(JSON.stringify(message));
    }
  }

  async handleDisconnect(tempPeerId) {
    const connection = this.connections.get(tempPeerId);
    if (connection) {
      const peerId = connection.peerId;
      
      if (peerId) {
        await PeerManager.updatePeerStatus(peerId, false);
        
        this.resourcePeers.forEach((peers, resourceId) => {
          if (peers.has(peerId)) {
            peers.delete(peerId);
            ChunkAvailabilityManager.removePeerFromAllChunks(resourceId, peerId);
            ResourceManager.removePeerFromResource(resourceId, peerId);
          }
        });

        this.connections.forEach((conn) => {
          if (conn.peerId) {
            this.sendToPeer(conn.peerId, {
              type: 'peer_left',
              peerId: peerId
            });
          }
        });
      }
      
      this.connections.delete(tempPeerId);
    }
  }

  async cleanupInactivePeers() {
    await PeerManager.cleanupInactivePeers();
  }
}

module.exports = WebSocketServer;
