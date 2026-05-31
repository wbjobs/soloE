const Peer = require('../models/Peer');
const config = require('../config');

class ReputationManager {
  constructor() {
    this.config = config.reputation;
  }

  async updateReputationScore(peer) {
    const uploadDownloadRatio = peer.calculateUploadDownloadRatio();
    const ratioScore = this.calculateRatioScore(uploadDownloadRatio);

    const integrityScore = this.calculateIntegrityScore(peer.reputation.integrityFailures);

    const onlineTimeScore = this.calculateOnlineTimeScore(peer.reputation.totalOnlineSeconds);

    const uploadSuccessRateScore = this.calculateUploadSuccessRateScore(
      peer.reputation.successfulUploads,
      peer.reputation.failedUploads
    );

    const totalScore =
      ratioScore * this.config.uploadDownloadRatioWeight +
      integrityScore * this.config.integrityWeight +
      onlineTimeScore * this.config.onlineTimeWeight +
      uploadSuccessRateScore * this.config.uploadSuccessRateWeight;

    const finalScore = Math.max(
      this.config.minScore,
      Math.min(this.config.maxScore, Math.round(totalScore * 100))
    );

    peer.reputation.score = finalScore;

    if (finalScore < this.config.lowReputationThreshold) {
      await this.addToBlacklist(peer, 'low_reputation');
    }

    await peer.save();
    return finalScore;
  }

  calculateRatioScore(ratio) {
    if (ratio >= 1.5) return 1.0;
    if (ratio >= 1.0) return 0.8;
    if (ratio >= 0.7) return 0.6;
    if (ratio >= 0.5) return 0.4;
    if (ratio >= 0.3) return 0.2;
    return 0.1;
  }

  calculateIntegrityScore(failures) {
    if (failures === 0) return 1.0;
    if (failures === 1) return 0.8;
    if (failures <= 3) return 0.5;
    if (failures <= 5) return 0.3;
    return 0.1;
  }

  calculateOnlineTimeScore(totalSeconds) {
    const hours = totalSeconds / 3600;
    if (hours >= 168) return 1.0;
    if (hours >= 72) return 0.8;
    if (hours >= 24) return 0.6;
    if (hours >= 8) return 0.4;
    if (hours >= 2) return 0.2;
    return 0.1;
  }

  calculateUploadSuccessRateScore(successful, failed) {
    const total = successful + failed;
    if (total === 0) return 0.5;
    const rate = successful / total;
    if (rate >= 0.95) return 1.0;
    if (rate >= 0.85) return 0.8;
    if (rate >= 0.70) return 0.6;
    if (rate >= 0.50) return 0.4;
    return 0.2;
  }

  async recordUpload(peerId, bytesUploaded, success = true) {
    const peer = await Peer.findOne({ peerId });
    if (!peer) return null;

    peer.reputation.totalUploaded += bytesUploaded;
    
    if (success) {
      peer.reputation.successfulUploads++;
      const mbUploaded = bytesUploaded / (1024 * 1024);
      peer.reputation.score = Math.min(
        this.config.maxScore,
        peer.reputation.score + mbUploaded * this.config.uploadBonusPerMB
      );
    } else {
      peer.reputation.failedUploads++;
      peer.reputation.score = Math.max(
        this.config.minScore,
        peer.reputation.score - this.config.uploadFailurePenalty
      );
    }

    await this.updateReputationScore(peer);
    return peer;
  }

  async recordDownload(peerId, bytesDownloaded) {
    const peer = await Peer.findOne({ peerId });
    if (!peer) return null;

    peer.reputation.totalDownloaded += bytesDownloaded;
    
    const mbDownloaded = bytesDownloaded / (1024 * 1024);
    peer.reputation.score = Math.max(
      this.config.minScore,
      peer.reputation.score - mbDownloaded * this.config.downloadPenaltyPerMB
    );

    await this.updateReputationScore(peer);
    return peer;
  }

  async recordIntegrityFailure(peerId) {
    const peer = await Peer.findOne({ peerId });
    if (!peer) return null;

    peer.reputation.integrityFailures++;
    peer.reputation.score = Math.max(
      this.config.minScore,
      peer.reputation.score - this.config.integrityFailurePenalty
    );

    await this.updateReputationScore(peer);
    return peer;
  }

  async updateOnlineTime(peerId) {
    const peer = await Peer.findOne({ peerId });
    if (!peer) return null;

    const now = new Date();
    const lastOnline = peer.reputation.lastOnlineAt;
    const secondsElapsed = Math.floor((now - lastOnline) / 1000);

    if (secondsElapsed > 0) {
      peer.reputation.totalOnlineSeconds += secondsElapsed;
      peer.reputation.lastOnlineAt = now;

      const hoursElapsed = secondsElapsed / 3600;
      peer.reputation.score = Math.min(
        this.config.maxScore,
        peer.reputation.score + hoursElapsed * this.config.onlineTimeBonusPerHour
      );

      await this.updateReputationScore(peer);
    }

    return peer;
  }

  async addToBlacklist(peer, reason = 'low_reputation') {
    peer.reputation.isBlacklisted = true;
    peer.reputation.blacklistedUntil = new Date(Date.now() + this.config.blacklistDuration);
    peer.reputation.blacklistReason = reason;
    await peer.save();
    return peer;
  }

  async removeFromBlacklist(peerId) {
    const peer = await Peer.findOne({ peerId });
    if (!peer) return null;

    peer.reputation.isBlacklisted = false;
    peer.reputation.blacklistedUntil = null;
    peer.reputation.blacklistReason = null;
    await peer.save();
    return peer;
  }

  async isBlacklisted(peerId) {
    const peer = await Peer.findOne({ peerId });
    if (!peer) return false;
    return peer.isInBlacklist();
  }

  async getHighReputationPeers(minScore = null) {
    const threshold = minScore || this.config.highReputationThreshold;
    return await Peer.find({
      isActive: true,
      'reputation.score': { $gte: threshold },
      $or: [
        { 'reputation.isBlacklisted': false },
        { 'reputation.blacklistedUntil': { $lt: new Date() } }
      ]
    });
  }

  async decayReputation() {
    const peers = await Peer.find({
      'reputation.lastDecayAt': { $lt: new Date(Date.now() - this.config.decayInterval) }
    });

    const results = [];
    for (const peer of peers) {
      const oldScore = peer.reputation.score;
      const decayAmount = this.config.decayRate;
      
      if (oldScore > this.config.defaultScore) {
        peer.reputation.score = Math.max(
          this.config.defaultScore,
          oldScore - decayAmount
        );
      } else if (oldScore < this.config.defaultScore) {
        peer.reputation.score = Math.min(
          this.config.defaultScore,
          oldScore + decayAmount * 0.5
        );
      }

      peer.reputation.lastDecayAt = new Date();
      await peer.save();
      
      results.push({
        peerId: peer.peerId,
        oldScore,
        newScore: peer.reputation.score
      });
    }

    return results;
  }

  async cleanupExpiredBlacklists() {
    const result = await Peer.updateMany(
      {
        'reputation.isBlacklisted': true,
        'reputation.blacklistedUntil': { $lt: new Date() }
      },
      {
        $set: {
          'reputation.isBlacklisted': false,
          'reputation.blacklistedUntil': null,
          'reputation.blacklistReason': null
        }
      }
    );
    return result;
  }

  async getPeerReputation(peerId) {
    const peer = await Peer.findOne({ peerId });
    if (!peer) return null;

    return {
      peerId: peer.peerId,
      score: peer.reputation.score,
      totalUploaded: peer.reputation.totalUploaded,
      totalDownloaded: peer.reputation.totalDownloaded,
      uploadDownloadRatio: peer.calculateUploadDownloadRatio(),
      integrityFailures: peer.reputation.integrityFailures,
      totalOnlineSeconds: peer.reputation.totalOnlineSeconds,
      successfulUploads: peer.reputation.successfulUploads,
      failedUploads: peer.reputation.failedUploads,
      isBlacklisted: peer.isInBlacklist(),
      blacklistedUntil: peer.reputation.blacklistedUntil,
      blacklistReason: peer.reputation.blacklistReason
    };
  }

  async resetReputation(peerId) {
    const peer = await Peer.findOne({ peerId });
    if (!peer) return null;

    peer.reputation.score = this.config.defaultScore;
    peer.reputation.totalUploaded = 0;
    peer.reputation.totalDownloaded = 0;
    peer.reputation.integrityFailures = 0;
    peer.reputation.successfulUploads = 0;
    peer.reputation.failedUploads = 0;
    peer.reputation.isBlacklisted = false;
    peer.reputation.blacklistedUntil = null;
    peer.reputation.blacklistReason = null;

    await peer.save();
    return peer;
  }
}

module.exports = new ReputationManager();