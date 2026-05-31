class SpeakerDetector {
  constructor() {
    this.roomSpeakers = new Map();
    this.SPEAKER_THRESHOLD = 0.01;
    this.MIN_SPEAKING_TIME = 10000;
    this.VOLUME_DOMINANCE_RATIO = 1.3;
    this.SILENCE_TIMEOUT = 3000;
  }

  initializeRoom(roomId) {
    if (!this.roomSpeakers.has(roomId)) {
      this.roomSpeakers.set(roomId, {
        participants: new Map(),
        currentSpeaker: null,
        speakerStartTime: 0,
        lastActivityTime: 0
      });
      console.log(`[SpeakerDetector] Room ${roomId} initialized`);
    }
  }

  removeRoom(roomId) {
    this.roomSpeakers.delete(roomId);
  }

  addParticipant(roomId, clientId, clientName) {
    const room = this.roomSpeakers.get(roomId);
    if (!room) return;

    room.participants.set(clientId, {
      name: clientName,
      volumeHistory: [],
      speaking: false,
      speakingStartTime: 0,
      totalSpeakingTime: 0,
      lastVolumeTime: 0
    });
  }

  removeParticipant(roomId, clientId) {
    const room = this.roomSpeakers.get(roomId);
    if (!room) return;

    room.participants.delete(clientId);

    if (room.currentSpeaker === clientId) {
      room.currentSpeaker = null;
      room.speakerStartTime = 0;
    }
  }

  updateVolume(roomId, clientId, volume) {
    const room = this.roomSpeakers.get(roomId);
    if (!room) return null;

    const participant = room.participants.get(clientId);
    if (!participant) return null;

    const now = Date.now();
    participant.volumeHistory.push({ time: now, volume });
    
    if (participant.volumeHistory.length > 50) {
      participant.volumeHistory.shift();
    }

    const isSpeaking = volume > this.SPEAKER_THRESHOLD;
    
    if (isSpeaking && !participant.speaking) {
      participant.speaking = true;
      participant.speakingStartTime = now;
    } else if (!isSpeaking && participant.speaking) {
      participant.speaking = false;
      participant.totalSpeakingTime += (now - participant.speakingStartTime);
    }

    participant.lastVolumeTime = now;
    room.lastActivityTime = now;

    return this.detectSpeaker(roomId, clientId);
  }

  detectSpeaker(roomId, clientId) {
    const room = this.roomSpeakers.get(roomId);
    if (!room) return null;

    const now = Date.now();
    const activeParticipants = [];

    for (const [id, participant] of room.participants) {
      if (now - participant.lastVolumeTime < 5000) {
        const avgVolume = this.getAverageVolume(participant);
        activeParticipants.push({ clientId: id, avgVolume, participant });
      }
    }

    if (activeParticipants.length === 0) {
      if (room.currentSpeaker && now - room.lastActivityTime > this.SILENCE_TIMEOUT) {
        const previousSpeaker = room.currentSpeaker;
        room.currentSpeaker = null;
        room.speakerStartTime = 0;
        console.log(`[SpeakerDetector] Speaker cleared due to silence in room ${roomId}`);
        return { action: 'clear', previousSpeaker };
      }
      return null;
    }

    activeParticipants.sort((a, b) => b.avgVolume - a.avgVolume);
    const loudest = activeParticipants[0];

    if (loudest.avgVolume < this.SPEAKER_THRESHOLD) {
      if (room.currentSpeaker && now - room.lastActivityTime > this.SILENCE_TIMEOUT) {
        const previousSpeaker = room.currentSpeaker;
        room.currentSpeaker = null;
        room.speakerStartTime = 0;
        return { action: 'clear', previousSpeaker };
      }
      return null;
    }

    let isDominant = true;
    if (activeParticipants.length > 1) {
      const secondLoudest = activeParticipants[1];
      if (secondLoudest.avgVolume > 0) {
        const ratio = loudest.avgVolume / secondLoudest.avgVolume;
        isDominant = ratio >= this.VOLUME_DOMINANCE_RATIO;
      }
    }

    if (!isDominant) {
      return null;
    }

    const currentSpeakingDuration = loudest.participant.speaking 
      ? now - loudest.participant.speakingStartTime 
      : 0;

    if (currentSpeakingDuration >= this.MIN_SPEAKING_TIME) {
      if (room.currentSpeaker !== loudest.clientId) {
        const previousSpeaker = room.currentSpeaker;
        room.currentSpeaker = loudest.clientId;
        room.speakerStartTime = now;

        console.log(`[SpeakerDetector] New speaker detected in room ${roomId}: ${loudest.participant.name}`);
        console.log(`[SpeakerDetector] Volume: ${loudest.avgVolume.toFixed(4)}, Duration: ${currentSpeakingDuration}ms`);

        return {
          action: 'new',
          speakerId: loudest.clientId,
          speakerName: loudest.participant.name,
          previousSpeaker,
          volume: loudest.avgVolume,
          duration: currentSpeakingDuration
        };
      }
    }

    return null;
  }

  getAverageVolume(participant) {
    if (participant.volumeHistory.length === 0) return 0;
    
    const recentVolumes = participant.volumeHistory.slice(-10);
    const sum = recentVolumes.reduce((acc, v) => acc + v.volume, 0);
    return sum / recentVolumes.length;
  }

  getCurrentSpeaker(roomId) {
    const room = this.roomSpeakers.get(roomId);
    if (!room || !room.currentSpeaker) return null;

    const participant = room.participants.get(room.currentSpeaker);
    return {
      clientId: room.currentSpeaker,
      name: participant?.name,
      speakingSince: room.speakerStartTime
    };
  }

  getRoomSpeakerStats(roomId) {
    const room = this.roomSpeakers.get(roomId);
    if (!room) return null;

    const stats = [];
    for (const [clientId, participant] of room.participants) {
      stats.push({
        clientId,
        name: participant.name,
        avgVolume: this.getAverageVolume(participant),
        isSpeaking: participant.speaking,
        totalSpeakingTime: participant.totalSpeakingTime
      });
    }

    return {
      currentSpeaker: room.currentSpeaker,
      participants: stats
    };
  }
}

module.exports = SpeakerDetector;
