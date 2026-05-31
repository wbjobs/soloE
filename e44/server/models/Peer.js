const mongoose = require('mongoose');

const peerSchema = new mongoose.Schema({
  peerId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  ip: {
    type: String,
    required: true
  },
  location: {
    country: String,
    region: String,
    city: String,
    latitude: Number,
    longitude: Number
  },
  natType: {
    type: String,
    enum: ['public', 'cone', 'symmetric', 'blocked', 'unknown'],
    default: 'unknown'
  },
  uploadBandwidth: {
    type: Number,
    default: 0
  },
  downloadBandwidth: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  connectedPeers: [{
    type: String
  }],
  lastSeen: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  reputation: {
    score: {
      type: Number,
      default: 70,
      min: 0,
      max: 100
    },
    totalUploaded: {
      type: Number,
      default: 0
    },
    totalDownloaded: {
      type: Number,
      default: 0
    },
    integrityFailures: {
      type: Number,
      default: 0
    },
    totalOnlineSeconds: {
      type: Number,
      default: 0
    },
    lastOnlineAt: {
      type: Date,
      default: Date.now
    },
    successfulUploads: {
      type: Number,
      default: 0
    },
    failedUploads: {
      type: Number,
      default: 0
    },
    isBlacklisted: {
      type: Boolean,
      default: false
    },
    blacklistedUntil: {
      type: Date,
      default: null
    },
    blacklistReason: {
      type: String,
      default: null
    },
    lastDecayAt: {
      type: Date,
      default: Date.now
    }
  }
});

peerSchema.index({ isActive: 1, lastSeen: -1 });
peerSchema.index({ 'location.country': 1, 'location.city': 1 });
peerSchema.index({ 'reputation.score': 1, 'reputation.isBlacklisted': 1 });
peerSchema.index({ 'reputation.blacklistedUntil': 1 });

peerSchema.methods.calculateUploadDownloadRatio = function() {
  if (this.reputation.totalDownloaded === 0) {
    return this.reputation.totalUploaded > 0 ? 2.0 : 1.0;
  }
  return Math.min(2.0, this.reputation.totalUploaded / this.reputation.totalDownloaded);
};

peerSchema.methods.isInBlacklist = function() {
  if (!this.reputation.isBlacklisted) return false;
  if (!this.reputation.blacklistedUntil) return false;
  return new Date() < this.reputation.blacklistedUntil;
};

module.exports = mongoose.model('Peer', peerSchema);
