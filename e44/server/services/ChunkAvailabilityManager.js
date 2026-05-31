const ChunkAvailability = require('../models/ChunkAvailability');

class ChunkAvailabilityManager {
  async updatePeerChunks(resourceId, peerId, chunkIndices) {
    for (const chunkIndex of chunkIndices) {
      await ChunkAvailability.findOneAndUpdate(
        { resourceId, chunkIndex },
        {
          $set: { 'peers.$[peer].lastSeen': new Date() },
          $setOnInsert: {
            availabilityCount: 1,
            peers: [{ peerId, lastSeen: new Date() }]
          },
          updatedAt: new Date()
        },
        {
          arrayFilters: [{ 'peer.peerId': peerId }],
          upsert: true
        }
      );
      
      await ChunkAvailability.findOneAndUpdate(
        { resourceId, chunkIndex, 'peers.peerId': { $ne: peerId } },
        {
          $push: { peers: { peerId, lastSeen: new Date() } },
          $inc: { availabilityCount: 1 },
          updatedAt: new Date()
        }
      );
    }
  }

  async removePeerFromAllChunks(resourceId, peerId) {
    await ChunkAvailability.updateMany(
      { resourceId, 'peers.peerId': peerId },
      {
        $pull: { peers: { peerId } },
        $inc: { availabilityCount: -1 },
        updatedAt: new Date()
      }
    );
  }

  async getPeersForChunk(resourceId, chunkIndex) {
    const chunk = await ChunkAvailability.findOne({ resourceId, chunkIndex });
    if (!chunk) return [];
    return chunk.peers.filter(p => Date.now() - p.lastSeen.getTime() < 60000)
                       .map(p => p.peerId);
  }

  async getRarestChunks(resourceId, limit = 10) {
    return await ChunkAvailability.find({ resourceId })
      .sort({ availabilityCount: 1 })
      .limit(limit)
      .select('chunkIndex availabilityCount');
  }

  async getChunkAvailability(resourceId) {
    return await ChunkAvailability.find({ resourceId })
      .sort({ chunkIndex: 1 })
      .select('chunkIndex availabilityCount peers');
  }

  async cleanupInactivePeers(resourceId, timeoutMs = 60000) {
    const cutoffTime = new Date(Date.now() - timeoutMs);
    
    const chunks = await ChunkAvailability.find({ resourceId });
    
    for (const chunk of chunks) {
      const inactivePeers = chunk.peers
        .filter(p => p.lastSeen < cutoffTime)
        .map(p => p.peerId);
      
      if (inactivePeers.length > 0) {
        await ChunkAvailability.findOneAndUpdate(
          { _id: chunk._id },
          {
            $pull: { peers: { peerId: { $in: inactivePeers } } },
            $inc: { availabilityCount: -inactivePeers.length },
            updatedAt: new Date()
          }
        );
      }
    }
  }
}

module.exports = new ChunkAvailabilityManager();
