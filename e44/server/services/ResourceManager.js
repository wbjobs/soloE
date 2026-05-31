const Resource = require('../models/Resource');
const ChunkAvailability = require('../models/ChunkAvailability');
const crypto = require('crypto');
const config = require('../config');

class ResourceManager {
  async registerResource(resourceInfo) {
    const { resourceId, name, size, sourceUrl, mimeType } = resourceInfo;
    const chunkSize = config.p2p.chunkSize;
    const totalChunks = Math.ceil(size / chunkSize);
    
    const chunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const chunkByteSize = i === totalChunks - 1 
        ? size - i * chunkSize 
        : chunkSize;
      chunks.push({
        index: i,
        hash: '',
        size: chunkByteSize
      });
    }
    
    const resource = await Resource.findOneAndUpdate(
      { resourceId },
      {
        name,
        size,
        mimeType,
        sourceUrl,
        totalChunks,
        chunkSize,
        chunks,
        isActive: true,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    
    for (const chunk of chunks) {
      await ChunkAvailability.findOneAndUpdate(
        { resourceId, chunkIndex: chunk.index },
        {
          chunkHash: chunk.hash,
          updatedAt: new Date()
        },
        { upsert: true }
      );
    }
    
    return resource;
  }

  async getResource(resourceId) {
    return await Resource.findOne({ resourceId });
  }

  async updateChunkHash(resourceId, chunkIndex, hash) {
    const resource = await Resource.findOne({ resourceId });
    if (!resource) return null;
    
    resource.chunks[chunkIndex].hash = hash;
    resource.updatedAt = new Date();
    await resource.save();
    
    await ChunkAvailability.findOneAndUpdate(
      { resourceId, chunkIndex },
      { chunkHash: hash, updatedAt: new Date() }
    );
    
    return resource;
  }

  async addPeerToResource(resourceId, peerId, isSeeder = false) {
    const update = isSeeder 
      ? { $addToSet: { seeders: peerId }, $pull: { leechers: peerId } }
      : { $addToSet: { leechers: peerId } };
    
    return await Resource.findOneAndUpdate(
      { resourceId },
      { ...update, updatedAt: new Date() },
      { new: true }
    );
  }

  async removePeerFromResource(resourceId, peerId) {
    return await Resource.findOneAndUpdate(
      { resourceId },
      {
        $pull: { seeders: peerId, leechers: peerId },
        updatedAt: new Date()
      },
      { new: true }
    );
  }

  async getResourcePeers(resourceId) {
    const resource = await Resource.findOne({ resourceId });
    if (!resource) return { seeders: [], leechers: [] };
    return {
      seeders: resource.seeders,
      leechers: resource.leechers
    };
  }

  async getAllResources() {
    return await Resource.find({ isActive: true });
  }
}

module.exports = new ResourceManager();
