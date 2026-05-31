const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
  resourceId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  mimeType: String,
  sourceUrl: {
    type: String,
    required: true
  },
  totalChunks: {
    type: Number,
    required: true
  },
  chunkSize: {
    type: Number,
    required: true
  },
  chunks: [{
    index: Number,
    hash: String,
    size: Number
  }],
  infoHash: String,
  seeders: [{
    type: String,
    ref: 'Peer'
  }],
  leechers: [{
    type: String,
    ref: 'Peer'
  }],
  isActive: {
    type: Boolean,
    default: true
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

resourceSchema.index({ isActive: 1, 'seeders.0': 1 });
resourceSchema.index({ 'chunks.hash': 1 });

module.exports = mongoose.model('Resource', resourceSchema);
