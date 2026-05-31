const NetworkProbe = require('../network/NetworkProbe');

class BitrateAdaptation {
  constructor() {
    this.networkProbe = new NetworkProbe();
    this.qualityLayers = {
      low: { bitrate: 300000, spatialLayer: 0, temporalLayer: 0 },
      medium: { bitrate: 800000, spatialLayer: 1, temporalLayer: 1 },
      high: { bitrate: 1500000, spatialLayer: 2, temporalLayer: 2 }
    };
    this.clientQuality = new Map();
    this.hysteresisFactor = 0.1;
  }

  initializeClient(clientId) {
    this.networkProbe.initializeClient(clientId);
    this.clientQuality.set(clientId, {
      currentLayer: 'medium',
      targetLayer: 'medium',
      lastChangeTime: Date.now(),
      consecutiveImprovements: 0,
      consecutiveDegradations: 0,
      isTransitioning: false,
      rttTrend: 'stable',
      lastRtts: []
    });
  }

  removeClient(clientId) {
    this.networkProbe.removeClient(clientId);
    this.clientQuality.delete(clientId);
  }

  updateClientStats(clientId, stats) {
    this.networkProbe.updateStats(clientId, stats);
    
    const qualityData = this.clientQuality.get(clientId);
    if (qualityData) {
      qualityData.lastRtts.push(stats.rtt);
      if (qualityData.lastRtts.length > 5) {
        qualityData.lastRtts.shift();
      }
      
      if (qualityData.lastRtts.length >= 3) {
        const recentRtt = qualityData.lastRtts.slice(-3);
        const avgRtt = recentRtt.reduce((a, b) => a + b, 0) / 3;
        const firstRtt = qualityData.lastRtts[0];
        
        if (avgRtt > firstRtt * 1.5) {
          qualityData.rttTrend = 'increasing';
        } else if (avgRtt < firstRtt * 0.7) {
          qualityData.rttTrend = 'decreasing';
        } else {
          qualityData.rttTrend = 'stable';
        }
      }
    }
    
    return this.adjustQualityLayer(clientId);
  }

  adjustQualityLayer(clientId) {
    const qualityData = this.clientQuality.get(clientId);
    if (!qualityData) return null;

    const networkStatus = this.networkProbe.getClientStatus(clientId);
    const networkScore = networkStatus.networkScore;

    const upgradeMinInterval = 5000;
    const downgradeMinInterval = 2000;
    const timeSinceLastChange = Date.now() - qualityData.lastChangeTime;

    const layerOrder = ['low', 'medium', 'high'];
    const currentIndex = layerOrder.indexOf(qualityData.currentLayer);

    const upgradeThreshold = 0.75 + this.hysteresisFactor;
    const downgradeThreshold = 0.25 - this.hysteresisFactor;
    const emergencyDowngradeThreshold = 0.1;

    if (networkScore <= emergencyDowngradeThreshold && currentIndex > 0) {
      qualityData.targetLayer = 'low';
      qualityData.lastChangeTime = Date.now();
      qualityData.consecutiveImprovements = 0;
      qualityData.consecutiveDegradations = 0;
      qualityData.isTransitioning = true;
      console.log(`[BitrateAdaptation] Emergency downgrade for ${clientId}: score=${networkScore.toFixed(2)}`);
      return qualityData.targetLayer;
    }

    if (qualityData.rttTrend === 'increasing' && timeSinceLastChange >= downgradeMinInterval && currentIndex > 0) {
      qualityData.consecutiveDegradations++;
      if (qualityData.consecutiveDegradations >= 2) {
        qualityData.targetLayer = layerOrder[currentIndex - 1];
        qualityData.lastChangeTime = Date.now();
        qualityData.consecutiveImprovements = 0;
        qualityData.consecutiveDegradations = 0;
        qualityData.isTransitioning = true;
        console.log(`[BitrateAdaptation] RTT trend downgrade for ${clientId}: ${qualityData.currentLayer} -> ${qualityData.targetLayer}`);
        return qualityData.targetLayer;
      }
    }

    if (networkScore >= upgradeThreshold && currentIndex < layerOrder.length - 1 && timeSinceLastChange >= upgradeMinInterval) {
      qualityData.consecutiveImprovements++;
      if (qualityData.consecutiveImprovements >= 4) {
        qualityData.targetLayer = layerOrder[currentIndex + 1];
        qualityData.lastChangeTime = Date.now();
        qualityData.consecutiveImprovements = 0;
        qualityData.consecutiveDegradations = 0;
        qualityData.isTransitioning = true;
        console.log(`[BitrateAdaptation] Upgrade for ${clientId}: ${qualityData.currentLayer} -> ${qualityData.targetLayer}`);
        return qualityData.targetLayer;
      }
    } else if (networkScore <= downgradeThreshold && currentIndex > 0 && timeSinceLastChange >= downgradeMinInterval) {
      qualityData.consecutiveDegradations++;
      if (qualityData.consecutiveDegradations >= 3) {
        qualityData.targetLayer = layerOrder[currentIndex - 1];
        qualityData.lastChangeTime = Date.now();
        qualityData.consecutiveImprovements = 0;
        qualityData.consecutiveDegradations = 0;
        qualityData.isTransitioning = true;
        console.log(`[BitrateAdaptation] Downgrade for ${clientId}: ${qualityData.currentLayer} -> ${qualityData.targetLayer}`);
        return qualityData.targetLayer;
      }
    } else {
      qualityData.consecutiveImprovements = 0;
      qualityData.consecutiveDegradations = 0;
    }

    return qualityData.currentLayer;
  }

  confirmLayerChange(clientId) {
    const qualityData = this.clientQuality.get(clientId);
    if (qualityData && qualityData.isTransitioning) {
      qualityData.currentLayer = qualityData.targetLayer;
      qualityData.isTransitioning = false;
      console.log(`[BitrateAdaptation] Layer change confirmed for ${clientId}: ${qualityData.currentLayer}`);
    }
  }

  getQualityLayer(clientId) {
    const qualityData = this.clientQuality.get(clientId);
    return qualityData ? qualityData.currentLayer : 'medium';
  }

  getQualityLayerConfig(clientId) {
    const layer = this.getQualityLayer(clientId);
    return this.qualityLayers[layer];
  }

  getClientNetworkStatus(clientId) {
    return this.networkProbe.getClientStatus(clientId);
  }

  getAllClientsStatus() {
    const status = {};
    for (const clientId of this.clientQuality.keys()) {
      status[clientId] = {
        qualityLayer: this.getQualityLayer(clientId),
        network: this.getClientNetworkStatus(clientId)
      };
    }
    return status;
  }
}

module.exports = BitrateAdaptation;
