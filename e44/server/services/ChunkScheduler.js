const ChunkAvailability = require('../models/ChunkAvailability');
const PeerSelector = require('./PeerSelector');

class ChunkScheduler {
  constructor() {
    this.rarestFirstRatio = 0.7;
  }

  async getDownloadSchedule(resourceId, peerId, downloadedChunks, limit = 20) {
    const chunkAvailability = await ChunkAvailability.find({ resourceId });
    
    const availableChunks = chunkAvailability.filter(chunk => 
      chunk.availabilityCount > 0 && !downloadedChunks.includes(chunk.chunkIndex)
    );
    
    if (availableChunks.length === 0) {
      return [];
    }
    
    availableChunks.sort((a, b) => a.availabilityCount - b.availabilityCount);
    
    const rarestCount = Math.floor(limit * this.rarestFirstRatio);
    const rarestChunks = availableChunks.slice(0, rarestCount);
    
    const remainingChunks = availableChunks.slice(rarestCount);
    const randomChunks = this.shuffleArray(remainingChunks).slice(0, limit - rarestCount);
    
    const scheduledChunks = [...rarestChunks, ...randomChunks];
    
    const result = [];
    for (const chunk of scheduledChunks) {
      const peers = await PeerSelector.selectPeersForChunk(
        resourceId,
        chunk.chunkIndex,
        peerId,
        3
      );
      
      result.push({
        chunkIndex: chunk.chunkIndex,
        availabilityCount: chunk.availabilityCount,
        peers: peers.map(p => ({
          peerId: p.peerId,
          score: p.score
        }))
      });
    }
    
    return result;
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  async getRarestFirst(resourceId, peerId, downloadedChunks, limit = 10) {
    const chunkAvailability = await ChunkAvailability.find({ resourceId });
    
    const availableChunks = chunkAvailability.filter(chunk => 
      chunk.availabilityCount > 0 && !downloadedChunks.includes(chunk.chunkIndex)
    );
    
    availableChunks.sort((a, b) => a.availabilityCount - b.availabilityCount);
    
    const result = [];
    for (const chunk of availableChunks.slice(0, limit)) {
      const peers = await PeerSelector.selectPeersForChunk(
        resourceId,
        chunk.chunkIndex,
        peerId,
        3
      );
      
      result.push({
        chunkIndex: chunk.chunkIndex,
        availabilityCount: chunk.availabilityCount,
        peers: peers.map(p => ({
          peerId: p.peerId,
          score: p.score
        }))
      });
    }
    
    return result;
  }

  async getEndGameModeChunks(resourceId, peerId, downloadedChunks, totalChunks) {
    const missingChunks = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!downloadedChunks.includes(i)) {
        missingChunks.push(i);
      }
    }
    
    const result = [];
    for (const chunkIndex of missingChunks) {
      const peers = await PeerSelector.selectPeersForChunk(
        resourceId,
        chunkIndex,
        peerId,
        5
      );
      
      result.push({
        chunkIndex,
        peers: peers.map(p => p.peerId)
      });
    }
    
    return result;
  }

  shouldEnterEndGameMode(downloadedCount, totalChunks) {
    const progress = downloadedCount / totalChunks;
    return progress >= 0.95;
  }
}

module.exports = new ChunkScheduler();
