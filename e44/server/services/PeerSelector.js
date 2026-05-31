const Peer = require('../models/Peer');
const config = require('../config');

class PeerSelector {
  constructor() {
    this.locationWeight = config.selection.locationWeight;
    this.natWeight = config.selection.natWeight;
    this.bandwidthWeight = config.selection.bandwidthWeight;
    this.reputationWeight = config.selection.reputationWeight;
    this.highReputationThreshold = config.reputation.highReputationThreshold;
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
    
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(value) {
    return value * Math.PI / 180;
  }

  getLocationScore(distance) {
    if (distance === Infinity) return 0;
    if (distance < 50) return 1.0;
    if (distance < 200) return 0.8;
    if (distance < 500) return 0.6;
    if (distance < 1000) return 0.4;
    if (distance < 2000) return 0.2;
    return 0.1;
  }

  getNATScore(natType) {
    const natScores = {
      'public': 1.0,
      'cone': 0.7,
      'symmetric': 0.3,
      'blocked': 0.0,
      'unknown': 0.5
    };
    return natScores[natType] || 0.5;
  }

  getBandwidthScore(uploadBandwidth) {
    if (uploadBandwidth >= 10000) return 1.0;
    if (uploadBandwidth >= 5000) return 0.8;
    if (uploadBandwidth >= 2000) return 0.6;
    if (uploadBandwidth >= 1000) return 0.4;
    if (uploadBandwidth >= 500) return 0.2;
    return 0.1;
  }

  getReputationScore(reputationScore, isBlacklisted) {
    if (isBlacklisted) return 0;
    return reputationScore / 100;
  }

  isBlacklisted(peer) {
    if (!peer.reputation) return false;
    if (!peer.reputation.isBlacklisted) return false;
    if (!peer.reputation.blacklistedUntil) return false;
    return new Date() < peer.reputation.blacklistedUntil;
  }

  calculatePeerScore(requestingPeer, targetPeer) {
    const distance = this.calculateDistance(
      requestingPeer.location?.latitude,
      requestingPeer.location?.longitude,
      targetPeer.location?.latitude,
      targetPeer.location?.longitude
    );
    
    const locationScore = this.getLocationScore(distance);
    const natScore = this.getNATScore(targetPeer.natType);
    const bandwidthScore = this.getBandwidthScore(targetPeer.uploadBandwidth);
    
    const peerBlacklisted = this.isBlacklisted(targetPeer);
    const reputationScore = this.getReputationScore(
      targetPeer.reputation?.score || 70,
      peerBlacklisted
    );
    
    const totalScore = 
      locationScore * this.locationWeight +
      natScore * this.natWeight +
      bandwidthScore * this.bandwidthWeight +
      reputationScore * this.reputationWeight;
    
    return {
      score: totalScore,
      isBlacklisted: peerBlacklisted,
      details: {
        distance,
        locationScore,
        natScore,
        bandwidthScore,
        reputationScore
      }
    };
  }

  async selectBestPeers(resourceId, requestingPeerId, candidatePeerIds, limit = 10) {
    const requestingPeer = await Peer.findOne({ peerId: requestingPeerId });
    if (!requestingPeer) return [];
    
    const candidates = await Peer.find({
      peerId: { $in: candidatePeerIds, $ne: requestingPeerId },
      isActive: true
    });
    
    const scoredPeers = candidates.map(peer => {
      const { score, isBlacklisted, details } = this.calculatePeerScore(requestingPeer, peer);
      return {
        peerId: peer.peerId,
        peer: peer.toObject(),
        score,
        isBlacklisted,
        reputationScore: peer.reputation?.score || 70,
        details
      };
    });
    
    const highReputationPeers = scoredPeers.filter(p => 
      !p.isBlacklisted && p.reputationScore >= this.highReputationThreshold
    );
    const otherPeers = scoredPeers.filter(p => 
      !p.isBlacklisted && p.reputationScore < this.highReputationThreshold
    );
    const blacklistedPeers = scoredPeers.filter(p => p.isBlacklisted);
    
    highReputationPeers.sort((a, b) => b.score - a.score);
    otherPeers.sort((a, b) => b.score - a.score);
    
    const prioritizedPeers = [...highReputationPeers, ...otherPeers];
    
    return prioritizedPeers.slice(0, limit);
  }

  async selectPeersForChunk(resourceId, chunkIndex, requestingPeerId, limit = 5) {
    const ChunkAvailability = require('../models/ChunkAvailability');
    const chunk = await ChunkAvailability.findOne({ resourceId, chunkIndex });
    
    if (!chunk || !chunk.peers || chunk.peers.length === 0) {
      return [];
    }
    
    const activePeerIds = chunk.peers
      .filter(p => Date.now() - p.lastSeen.getTime() < 60000)
      .map(p => p.peerId)
      .filter(id => id !== requestingPeerId);
    
    return await this.selectBestPeers(resourceId, requestingPeerId, activePeerIds, limit);
  }
}

module.exports = new PeerSelector();
