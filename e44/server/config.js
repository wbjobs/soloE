module.exports = {
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/p2p_cdn'
  },
  server: {
    port: process.env.PORT || 3000,
    wsPort: process.env.WS_PORT || 3001
  },
  p2p: {
    chunkSize: 1024 * 1024,
    maxPeers: 50,
    peerTimeout: 30000,
    iceGatheringTimeout: 5000,
    connectionTimeout: 15000,
    maxRetries: 3,
    stunServers: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun3.l.google.com:19302',
      'stun:stun4.l.google.com:19302',
      'stun:stun.relay.metered.ca:80',
      'stun:stun.cloudflare.com:3478'
    ],
    turnServers: [
      {
        urls: process.env.TURN_SERVER_URL || 'turn:turn.example.com:3478',
        username: process.env.TURN_USERNAME || 'p2pcdn',
        credential: process.env.TURN_CREDENTIAL || 'p2pcdn123'
      }
    ]
  },
  selection: {
    locationWeight: 0.25,
    natWeight: 0.2,
    bandwidthWeight: 0.25,
    reputationWeight: 0.3
  },
  reputation: {
    defaultScore: 70,
    minScore: 0,
    maxScore: 100,
    highReputationThreshold: 70,
    lowReputationThreshold: 30,
    blacklistDuration: 30 * 60 * 1000,
    decayInterval: 60 * 60 * 1000,
    decayRate: 0.5,
    uploadDownloadRatioWeight: 0.35,
    integrityWeight: 0.25,
    onlineTimeWeight: 0.2,
    uploadSuccessRateWeight: 0.2,
    uploadBonusPerMB: 0.01,
    downloadPenaltyPerMB: 0.005,
    integrityFailurePenalty: 5,
    onlineTimeBonusPerHour: 0.5,
    uploadSuccessBonus: 0.1,
    uploadFailurePenalty: 1
  }
};
