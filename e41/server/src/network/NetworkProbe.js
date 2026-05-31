class NetworkProbe {
  constructor() {
    this.clientStats = new Map();
    this.PROBE_INTERVAL = 1000;
    this.HISTORY_SIZE = 10;
  }

  initializeClient(clientId) {
    this.clientStats.set(clientId, {
      rttHistory: [],
      packetLossHistory: [],
      bitrateHistory: [],
      lastStatsTime: Date.now()
    });
  }

  removeClient(clientId) {
    this.clientStats.delete(clientId);
  }

  updateStats(clientId, stats) {
    const clientData = this.clientStats.get(clientId);
    if (!clientData) {
      this.initializeClient(clientId);
      return;
    }

    const now = Date.now();
    const timeDiff = now - clientData.lastStatsTime;

    if (stats.rtt !== undefined) {
      clientData.rttHistory.push({ time: now, value: stats.rtt });
      if (clientData.rttHistory.length > this.HISTORY_SIZE) {
        clientData.rttHistory.shift();
      }
    }

    if (stats.packetLoss !== undefined) {
      clientData.packetLossHistory.push({ time: now, value: stats.packetLoss });
      if (clientData.packetLossHistory.length > this.HISTORY_SIZE) {
        clientData.packetLossHistory.shift();
      }
    }

    if (stats.bitrate !== undefined) {
      clientData.bitrateHistory.push({ time: now, value: stats.bitrate });
      if (clientData.bitrateHistory.length > this.HISTORY_SIZE) {
        clientData.bitrateHistory.shift();
      }
    }

    clientData.lastStatsTime = now;
  }

  getAverageRTT(clientId) {
    const clientData = this.clientStats.get(clientId);
    if (!clientData || clientData.rttHistory.length === 0) return 0;

    const sum = clientData.rttHistory.reduce((acc, item) => acc + item.value, 0);
    return sum / clientData.rttHistory.length;
  }

  getAveragePacketLoss(clientId) {
    const clientData = this.clientStats.get(clientId);
    if (!clientData || clientData.packetLossHistory.length === 0) return 0;

    const sum = clientData.packetLossHistory.reduce((acc, item) => acc + item.value, 0);
    return sum / clientData.packetLossHistory.length;
  }

  getNetworkScore(clientId) {
    const avgRtt = this.getAverageRTT(clientId);
    const avgPacketLoss = this.getAveragePacketLoss(clientId);

    const rttScore = Math.max(0, 1 - avgRtt / 500);
    const lossScore = Math.max(0, 1 - avgPacketLoss / 20);

    return (rttScore * 0.6 + lossScore * 0.4);
  }

  getClientStatus(clientId) {
    return {
      avgRtt: this.getAverageRTT(clientId),
      avgPacketLoss: this.getAveragePacketLoss(clientId),
      networkScore: this.getNetworkScore(clientId)
    };
  }
}

module.exports = NetworkProbe;
