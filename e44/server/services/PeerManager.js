const Peer = require('../models/Peer');
const ReputationManager = require('./ReputationManager');
const geoip = require('geoip-lite');
const config = require('../config');

class PeerManager {
  constructor() {
    this.reputationManager = ReputationManager;
  }

  async registerPeer(peerId, ip, peerInfo = {}) {
    const location = this.getLocationFromIP(ip);
    const now = new Date();
    
    const peer = await Peer.findOneAndUpdate(
      { peerId },
      {
        ip,
        location,
        natType: peerInfo.natType || 'unknown',
        uploadBandwidth: peerInfo.uploadBandwidth || 0,
        downloadBandwidth: peerInfo.downloadBandwidth || 0,
        isActive: true,
        lastSeen: now,
        $setOnInsert: {
          'reputation.score': config.reputation.defaultScore,
          'reputation.lastOnlineAt': now,
          'reputation.lastDecayAt': now
        }
      },
      { upsert: true, new: true }
    );
    
    await this.reputationManager.updateOnlineTime(peerId);
    return peer;
  }

  getLocationFromIP(ip) {
    const geo = geoip.lookup(ip);
    if (geo) {
      return {
        country: geo.country,
        region: geo.region,
        city: geo.city,
        latitude: geo.ll ? geo.ll[0] : null,
        longitude: geo.ll ? geo.ll[1] : null
      };
    }
    return {};
  }

  async updatePeerStatus(peerId, isActive = true) {
    const peer = await Peer.findOneAndUpdate(
      { peerId },
      { isActive, lastSeen: new Date() },
      { new: true }
    );
    
    if (peer && isActive) {
      await this.reputationManager.updateOnlineTime(peerId);
    }
    
    return peer;
  }

  async getPeer(peerId) {
    return await Peer.findOne({ peerId });
  }

  async getActivePeers() {
    return await Peer.find({ isActive: true });
  }

  async removePeer(peerId) {
    return await Peer.findOneAndUpdate(
      { peerId },
      { isActive: false },
      { new: true }
    );
  }

  async updatePeerBandwidth(peerId, uploadBandwidth, downloadBandwidth) {
    return await Peer.findOneAndUpdate(
      { peerId },
      { uploadBandwidth, downloadBandwidth, lastSeen: new Date() },
      { new: true }
    );
  }

  async updatePeerNATType(peerId, natType) {
    return await Peer.findOneAndUpdate(
      { peerId },
      { natType, lastSeen: new Date() },
      { new: true }
    );
  }

  async cleanupInactivePeers(timeoutMs = 30000) {
    const cutoffTime = new Date(Date.now() - timeoutMs);
    return await Peer.updateMany(
      { lastSeen: { $lt: cutoffTime }, isActive: true },
      { isActive: false }
    );
  }

  async recordUpload(peerId, bytesUploaded, success = true) {
    return await this.reputationManager.recordUpload(peerId, bytesUploaded, success);
  }

  async recordDownload(peerId, bytesDownloaded) {
    return await this.reputationManager.recordDownload(peerId, bytesDownloaded);
  }

  async recordIntegrityFailure(peerId) {
    return await this.reputationManager.recordIntegrityFailure(peerId);
  }

  async getPeerReputation(peerId) {
    return await this.reputationManager.getPeerReputation(peerId);
  }

  async isBlacklisted(peerId) {
    return await this.reputationManager.isBlacklisted(peerId);
  }
}

module.exports = new PeerManager();
