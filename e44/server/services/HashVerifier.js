const crypto = require('crypto');
const Resource = require('../models/Resource');

class HashVerifier {
  calculateSHA256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  async verifyChunk(resourceId, chunkIndex, chunkData) {
    const resource = await Resource.findOne({ resourceId });
    if (!resource) {
      return { valid: false, error: 'Resource not found' };
    }
    
    const chunk = resource.chunks[chunkIndex];
    if (!chunk) {
      return { valid: false, error: 'Chunk not found' };
    }
    
    const calculatedHash = this.calculateSHA256(chunkData);
    const isValid = calculatedHash === chunk.hash;
    
    return {
      valid: isValid,
      expectedHash: chunk.hash,
      actualHash: calculatedHash
    };
  }

  async verifyChunks(resourceId, chunksData) {
    const resource = await Resource.findOne({ resourceId });
    if (!resource) {
      return { valid: false, error: 'Resource not found' };
    }
    
    const results = [];
    let allValid = true;
    
    for (const { chunkIndex, data } of chunksData) {
      const chunk = resource.chunks[chunkIndex];
      if (!chunk) {
        results.push({
          chunkIndex,
          valid: false,
          error: 'Chunk not found'
        });
        allValid = false;
        continue;
      }
      
      const calculatedHash = this.calculateSHA256(data);
      const isValid = calculatedHash === chunk.hash;
      
      if (!isValid) allValid = false;
      
      results.push({
        chunkIndex,
        valid: isValid,
        expectedHash: chunk.hash,
        actualHash: calculatedHash
      });
    }
    
    return {
      valid: allValid,
      results
    };
  }

  async registerChunkHashes(resourceId, chunkHashes) {
    const resource = await Resource.findOne({ resourceId });
    if (!resource) {
      return null;
    }
    
    for (const { chunkIndex, hash } of chunkHashes) {
      if (resource.chunks[chunkIndex]) {
        resource.chunks[chunkIndex].hash = hash;
      }
    }
    
    resource.updatedAt = new Date();
    await resource.save();
    
    return resource;
  }

  async getChunkHash(resourceId, chunkIndex) {
    const resource = await Resource.findOne({ resourceId });
    if (!resource || !resource.chunks[chunkIndex]) {
      return null;
    }
    return resource.chunks[chunkIndex].hash;
  }

  async getAllChunkHashes(resourceId) {
    const resource = await Resource.findOne({ resourceId });
    if (!resource) {
      return null;
    }
    return resource.chunks.map(chunk => ({
      index: chunk.index,
      hash: chunk.hash
    }));
  }

  generateMerkleRoot(hashes) {
    if (hashes.length === 0) return '';
    if (hashes.length === 1) return hashes[0];
    
    const nextLevel = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = hashes[i + 1] || hashes[i];
      const combined = left + right;
      const hash = crypto.createHash('sha256').update(combined).digest('hex');
      nextLevel.push(hash);
    }
    
    return this.generateMerkleRoot(nextLevel);
  }

  async verifyMerkleRoot(resourceId, receivedHashes) {
    const resource = await Resource.findOne({ resourceId });
    if (!resource) {
      return { valid: false, error: 'Resource not found' };
    }
    
    const expectedHashes = resource.chunks.map(c => c.hash);
    const expectedRoot = this.generateMerkleRoot(expectedHashes);
    const receivedRoot = this.generateMerkleRoot(receivedHashes);
    
    return {
      valid: expectedRoot === receivedRoot,
      expectedRoot,
      receivedRoot
    };
  }
}

module.exports = new HashVerifier();
