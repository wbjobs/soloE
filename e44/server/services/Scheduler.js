const ReputationManager = require('./ReputationManager');
const PeerManager = require('./PeerManager');
const config = require('../config');

class Scheduler {
  constructor() {
    this.reputationManager = ReputationManager;
    this.peerManager = PeerManager;
    this.jobs = new Map();
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      console.log('[Scheduler] Scheduler already running');
      return;
    }

    this.isRunning = true;
    console.log('[Scheduler] Starting scheduler...');

    this.scheduleReputationDecay();
    this.scheduleBlacklistCleanup();
    this.schedulePeerOnlineTimeUpdate();
    this.scheduleInactivePeerCleanup();

    console.log('[Scheduler] All scheduled jobs started');
  }

  stop() {
    console.log('[Scheduler] Stopping scheduler...');
    
    for (const [jobName, intervalId] of this.jobs) {
      clearInterval(intervalId);
      console.log(`[Scheduler] Stopped job: ${jobName}`);
    }
    
    this.jobs.clear();
    this.isRunning = false;
    console.log('[Scheduler] Scheduler stopped');
  }

  scheduleReputationDecay() {
    const interval = config.reputation.decayInterval;
    
    const intervalId = setInterval(async () => {
      try {
        console.log('[Scheduler] Running reputation decay...');
        const results = await this.reputationManager.decayReputation();
        console.log(`[Scheduler] Reputation decay completed for ${results.length} peers`);
      } catch (error) {
        console.error('[Scheduler] Error in reputation decay:', error);
      }
    }, interval);

    this.jobs.set('reputationDecay', intervalId);
    console.log(`[Scheduler] Scheduled reputation decay job (interval: ${interval}ms)`);
  }

  scheduleBlacklistCleanup() {
    const interval = 5 * 60 * 1000;
    
    const intervalId = setInterval(async () => {
      try {
        console.log('[Scheduler] Running expired blacklist cleanup...');
        const result = await this.reputationManager.cleanupExpiredBlacklists();
        console.log(`[Scheduler] Blacklist cleanup completed, removed ${result.modifiedCount} peers from blacklist`);
      } catch (error) {
        console.error('[Scheduler] Error in blacklist cleanup:', error);
      }
    }, interval);

    this.jobs.set('blacklistCleanup', intervalId);
    console.log(`[Scheduler] Scheduled blacklist cleanup job (interval: ${interval}ms)`);
  }

  schedulePeerOnlineTimeUpdate() {
    const interval = 5 * 60 * 1000;
    
    const intervalId = setInterval(async () => {
      try {
        console.log('[Scheduler] Running online time update for active peers...');
        
        const activePeers = await this.peerManager.getActivePeers();
        let updatedCount = 0;
        
        for (const peer of activePeers) {
          await this.reputationManager.updateOnlineTime(peer.peerId);
          updatedCount++;
        }
        
        console.log(`[Scheduler] Online time update completed for ${updatedCount} peers`);
      } catch (error) {
        console.error('[Scheduler] Error in online time update:', error);
      }
    }, interval);

    this.jobs.set('onlineTimeUpdate', intervalId);
    console.log(`[Scheduler] Scheduled online time update job (interval: ${interval}ms)`);
  }

  scheduleInactivePeerCleanup() {
    const interval = 5 * 60 * 1000;
    const timeout = 5 * 60 * 1000;
    
    const intervalId = setInterval(async () => {
      try {
        console.log('[Scheduler] Running inactive peer cleanup...');
        const result = await this.peerManager.cleanupInactivePeers(timeout);
        console.log(`[Scheduler] Inactive peer cleanup completed, marked ${result.modifiedCount} peers as inactive`);
      } catch (error) {
        console.error('[Scheduler] Error in inactive peer cleanup:', error);
      }
    }, interval);

    this.jobs.set('inactivePeerCleanup', intervalId);
    console.log(`[Scheduler] Scheduled inactive peer cleanup job (interval: ${interval}ms)`);
  }

  getJobStatus() {
    const status = {};
    for (const [jobName, intervalId] of this.jobs) {
      status[jobName] = {
        running: intervalId !== null,
        interval: this.getJobInterval(jobName)
      };
    }
    return status;
  }

  getJobInterval(jobName) {
    const intervals = {
      reputationDecay: config.reputation.decayInterval,
      blacklistCleanup: 5 * 60 * 1000,
      onlineTimeUpdate: 5 * 60 * 1000,
      inactivePeerCleanup: 5 * 60 * 1000
    };
    return intervals[jobName] || null;
  }

  async runJobManually(jobName) {
    console.log(`[Scheduler] Manually running job: ${jobName}`);
    
    switch (jobName) {
      case 'reputationDecay':
        return await this.reputationManager.decayReputation();
      case 'blacklistCleanup':
        return await this.reputationManager.cleanupExpiredBlacklists();
      case 'onlineTimeUpdate':
        const activePeers = await this.peerManager.getActivePeers();
        for (const peer of activePeers) {
          await this.reputationManager.updateOnlineTime(peer.peerId);
        }
        return { updatedCount: activePeers.length };
      case 'inactivePeerCleanup':
        return await this.peerManager.cleanupInactivePeers(5 * 60 * 1000);
      default:
        throw new Error(`Unknown job: ${jobName}`);
    }
  }
}

module.exports = new Scheduler();
