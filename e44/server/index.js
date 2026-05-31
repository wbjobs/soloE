const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const WebSocketServer = require('./WebSocketServer');
const ResourceManager = require('./services/ResourceManager');
const PeerManager = require('./services/PeerManager');
const HashVerifier = require('./services/HashVerifier');
const ReputationManager = require('./services/ReputationManager');
const Scheduler = require('./services/Scheduler');

const app = express();
const PORT = config.server.port;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

mongoose.connect(config.mongodb.uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('[P2P CDN] MongoDB connected');
  Scheduler.start();
})
.catch(err => console.error('[P2P CDN] MongoDB connection error:', err));

app.post('/api/resources', async (req, res) => {
  try {
    const { name, size, sourceUrl, mimeType } = req.body;
    const resourceId = 'res_' + Math.random().toString(36).substr(2, 9);
    
    const resource = await ResourceManager.registerResource({
      resourceId,
      name,
      size,
      sourceUrl,
      mimeType
    });
    
    res.json({ success: true, resource });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/resources/:resourceId', async (req, res) => {
  try {
    const resource = await ResourceManager.getResource(req.params.resourceId);
    if (!resource) {
      return res.status(404).json({ success: false, error: 'Resource not found' });
    }
    res.json({ success: true, resource });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/resources', async (req, res) => {
  try {
    const resources = await ResourceManager.getAllResources();
    res.json({ success: true, resources });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/resources/:resourceId/chunks', async (req, res) => {
  try {
    const { chunkIndex, hash } = req.body;
    await ResourceManager.updateChunkHash(req.params.resourceId, chunkIndex, hash);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/resources/:resourceId/hashes', async (req, res) => {
  try {
    const { hashes } = req.body;
    await HashVerifier.registerChunkHashes(req.params.resourceId, hashes);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/peers', async (req, res) => {
  try {
    const peers = await PeerManager.getActivePeers();
    res.json({ success: true, peers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/peers/:peerId', async (req, res) => {
  try {
    const peer = await PeerManager.getPeer(req.params.peerId);
    if (!peer) {
      return res.status(404).json({ success: false, error: 'Peer not found' });
    }
    res.json({ success: true, peer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const peers = await PeerManager.getActivePeers();
    const resources = await ResourceManager.getAllResources();
    
    res.json({
      success: true,
      stats: {
        activePeers: peers.length,
        totalResources: resources.length,
        uptime: process.uptime()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/ice-config', (req, res) => {
  const iceServers = [];
  
  config.p2p.stunServers.forEach(url => {
    iceServers.push({ urls: url });
  });
  
  config.p2p.turnServers.forEach(turn => {
    iceServers.push({
      urls: turn.urls,
      username: turn.username,
      credential: turn.credential
    });
  });
  
  res.json({
    success: true,
    iceServers: iceServers,
    config: {
      iceGatheringTimeout: config.p2p.iceGatheringTimeout,
      connectionTimeout: config.p2p.connectionTimeout,
      maxRetries: config.p2p.maxRetries
    }
  });
});

app.get('/api/reputation/:peerId', async (req, res) => {
  try {
    const reputation = await ReputationManager.getPeerReputation(req.params.peerId);
    if (!reputation) {
      return res.status(404).json({ success: false, error: 'Peer not found' });
    }
    res.json({ success: true, reputation });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/reputation', async (req, res) => {
  try {
    const Peer = require('./models/Peer');
    const peers = await Peer.find({}, 'peerId reputation.score reputation.isBlacklisted reputation.blacklistedUntil');
    
    const reputationList = peers.map(peer => ({
      peerId: peer.peerId,
      score: peer.reputation?.score || 70,
      isBlacklisted: peer.reputation?.isBlacklisted || false,
      blacklistedUntil: peer.reputation?.blacklistedUntil
    }));
    
    reputationList.sort((a, b) => b.score - a.score);
    
    res.json({ success: true, reputationList });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/reputation/:peerId/reset', async (req, res) => {
  try {
    const peer = await ReputationManager.resetReputation(req.params.peerId);
    if (!peer) {
      return res.status(404).json({ success: false, error: 'Peer not found' });
    }
    res.json({ success: true, peer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/reputation/:peerId/blacklist', async (req, res) => {
  try {
    const Peer = require('./models/Peer');
    const peer = await Peer.findOne({ peerId: req.params.peerId });
    if (!peer) {
      return res.status(404).json({ success: false, error: 'Peer not found' });
    }
    
    await ReputationManager.addToBlacklist(peer, req.body.reason || 'manual');
    res.json({ success: true, peer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/reputation/:peerId/unblacklist', async (req, res) => {
  try {
    const peer = await ReputationManager.removeFromBlacklist(req.params.peerId);
    if (!peer) {
      return res.status(404).json({ success: false, error: 'Peer not found' });
    }
    res.json({ success: true, peer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/scheduler/status', (req, res) => {
  try {
    const status = Scheduler.getJobStatus();
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/scheduler/run/:jobName', async (req, res) => {
  try {
    const result = await Scheduler.runJobManually(req.params.jobName);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const httpServer = app.listen(PORT, () => {
  console.log(`[P2P CDN] HTTP server running on port ${PORT}`);
});

const wsServer = new WebSocketServer(httpServer);

process.on('SIGINT', async () => {
  console.log('[P2P CDN] Shutting down...');
  Scheduler.stop();
  await mongoose.connection.close();
  process.exit(0);
});
