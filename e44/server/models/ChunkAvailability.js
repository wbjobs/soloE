const mongoose = require('mongoose');

const chunkAvailabilitySchema = new mongoose.Schema({
  resourceId: {
    type: String,
    required: true,
    index: true
  },
  chunkIndex: {
    type: Number,
    required: true
  },
  chunkHash: {
    type: String,
    required: true
  },
  peers: [{
    peerId: String,
    lastSeen: {
      type: Date,
      default: Date.now
    }
  }],
  availabilityCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

chunkAvailabilitySchema.index({ resourceId: 1, chunkIndex: 1 }, { unique: true });
chunkAvailabilitySchema.index({ availabilityCount: 1 });

module.exports = mongoose.model('ChunkAvailability', chunkAvailabilitySchema);
