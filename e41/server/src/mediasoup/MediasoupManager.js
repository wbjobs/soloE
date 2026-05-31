const mediasoup = require('mediasoup');
const mediasoupConfig = require('../config/mediasoupConfig');

class MediasoupManager {
  constructor() {
    this.workers = [];
    this.rooms = new Map();
    this.nextWorkerIndex = 0;
    this.speakerPriority = new Map();
  }

  async initializeWorkers(numWorkers = 2) {
    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker({
        ...mediasoupConfig.worker
      });
      worker.on('died', () => {
        console.error('Mediasoup worker died');
        process.exit(1);
      });
      this.workers.push(worker);
    }
    console.log(`Initialized ${this.workers.length} mediasoup workers`);
  }

  getNextWorker() {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  async createRoom(roomId) {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId);
    }

    const worker = this.getNextWorker();
    const router = await worker.createRouter({
      mediaCodecs: mediasoupConfig.router.mediaCodecs
    });

    const room = {
      id: roomId,
      router,
      participants: new Map(),
      createdAt: Date.now()
    };

    this.rooms.set(roomId, room);
    console.log(`Room ${roomId} created`);
    return room;
  }

  async createWebRtcTransport(roomId, clientId, direction) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const transport = await room.router.createWebRtcTransport({
      ...mediasoupConfig.webRtcTransport,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });

    if (!room.participants.has(clientId)) {
      room.participants.set(clientId, {
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      });
    }

    const participant = room.participants.get(clientId);
    participant.transports.set(transport.id, { transport, direction });

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });

    transport.on('close', () => {
      console.log(`Transport ${transport.id} closed`);
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    };
  }

  async connectTransport(roomId, clientId, transportId, dtlsParameters) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant = room.participants.get(clientId);
    if (!participant) {
      throw new Error(`Participant ${clientId} not found`);
    }

    const transportData = participant.transports.get(transportId);
    if (!transportData) {
      throw new Error(`Transport ${transportId} not found`);
    }

    await transportData.transport.connect({ dtlsParameters });
  }

  async createProducer(roomId, clientId, transportId, kind, rtpParameters) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant = room.participants.get(clientId);
    if (!participant) {
      throw new Error(`Participant ${clientId} not found`);
    }

    const transportData = participant.transports.get(transportId);
    if (!transportData) {
      throw new Error(`Transport ${transportId} not found`);
    }

    const producer = await transportData.transport.produce({
      kind,
      rtpParameters
    });

    participant.producers.set(producer.id, {
      producer,
      kind,
      transportId
    });

    producer.on('score', (score) => {
    });

    return { id: producer.id };
  }

  async createConsumer(roomId, clientId, producerId, rtpCapabilities) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume');
    }

    const participant = room.participants.get(clientId);
    if (!participant) {
      throw new Error(`Participant ${clientId} not found`);
    }

    let consumerTransport = null;
    for (const [, transportData] of participant.transports) {
      if (transportData.direction === 'recv') {
        consumerTransport = transportData.transport;
        break;
      }
    }

    if (!consumerTransport) {
      throw new Error('No receive transport found');
    }

    const consumer = await consumerTransport.consume({
      producerId,
      rtpCapabilities,
      paused: false
    });

    participant.consumers.set(consumer.id, {
      consumer,
      producerId
    });

    consumer.on('transportclose', () => {
      console.log(`Consumer ${consumer.id} transport closed`);
    });

    consumer.on('producerclose', () => {
      console.log(`Consumer ${consumer.id} producer closed`);
      consumer.close();
      participant.consumers.delete(consumer.id);
    });

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters
    };
  }

  async setConsumerPreferredLayers(roomId, clientId, consumerId, spatialLayer, temporalLayer) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant = room.participants.get(clientId);
    if (!participant) {
      throw new Error(`Participant ${clientId} not found`);
    }

    const consumerData = participant.consumers.get(consumerId);
    if (!consumerData) {
      throw new Error(`Consumer ${consumerId} not found`);
    }

    await consumerData.consumer.setPreferredLayers({ spatialLayer, temporalLayer });
  }

  async setConsumerPreferredLayersSmooth(roomId, clientId, consumerId, targetSpatialLayer, targetTemporalLayer) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participant = room.participants.get(clientId);
    if (!participant) {
      throw new Error(`Participant ${clientId} not found`);
    }

    const consumerData = participant.consumers.get(consumerId);
    if (!consumerData) {
      throw new Error(`Consumer ${consumerId} not found`);
    }

    const consumer = consumerData.consumer;
    const currentLayers = consumer.preferredLayers || { spatialLayer: 2, temporalLayer: 2 };
    
    if (currentLayers.spatialLayer === targetSpatialLayer && 
        currentLayers.temporalLayer === targetTemporalLayer) {
      return;
    }

    const isDowngrading = targetSpatialLayer < currentLayers.spatialLayer || 
                          targetTemporalLayer < currentLayers.temporalLayer;

    if (isDowngrading) {
      if (currentLayers.temporalLayer > targetTemporalLayer) {
        await consumer.setPreferredLayers({
          spatialLayer: currentLayers.spatialLayer,
          temporalLayer: targetTemporalLayer
        });
        await this.delay(100);
      }

      if (currentLayers.spatialLayer > targetSpatialLayer) {
        const steps = currentLayers.spatialLayer - targetSpatialLayer;
        for (let i = 1; i <= steps; i++) {
          const intermediateSpatialLayer = currentLayers.spatialLayer - i;
          
          await consumer.setPreferredLayers({
            spatialLayer: intermediateSpatialLayer,
            temporalLayer: targetTemporalLayer
          });
          
          await this.delay(150);
        }
      }
    } else {
      if (currentLayers.spatialLayer < targetSpatialLayer) {
        for (let layer = currentLayers.spatialLayer + 1; layer <= targetSpatialLayer; layer++) {
          await consumer.setPreferredLayers({
            spatialLayer: layer,
            temporalLayer: currentLayers.temporalLayer
          });
          await this.delay(200);
        }
      }

      if (currentLayers.temporalLayer < targetTemporalLayer) {
        await this.delay(100);
        await consumer.setPreferredLayers({
          spatialLayer: targetSpatialLayer,
          temporalLayer: targetTemporalLayer
        });
      }
    }

    console.log(`[LayerSwitch] Consumer ${consumerId}: ${currentLayers.spatialLayer}/${currentLayers.temporalLayer} -> ${targetSpatialLayer}/${targetTemporalLayer} (downgrade: ${isDowngrading})`);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async requestProducerKeyFrame(roomId, producerId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    for (const [, participant] of room.participants) {
      const producerData = participant.producers.get(producerId);
      if (producerData && producerData.kind === 'video') {
        try {
          await producerData.producer.requestKeyFrame();
          console.log(`[KeyFrame] Requested key frame for producer ${producerId}`);
          return true;
        } catch (error) {
          console.warn(`[KeyFrame] Failed to request key frame:`, error);
        }
      }
    }
    return false;
  }

  getRoomParticipants(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const participants = [];
    for (const [clientId, participant] of room.participants) {
      const producers = [];
      for (const [producerId, producerData] of participant.producers) {
        producers.push({ id: producerId, kind: producerData.kind });
      }
      participants.push({ id: clientId, producers });
    }
    return participants;
  }

  removeParticipant(roomId, clientId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(clientId);
    if (!participant) return;

    for (const [, producerData] of participant.producers) {
      producerData.producer.close();
    }

    for (const [, consumerData] of participant.consumers) {
      consumerData.consumer.close();
    }

    for (const [, transportData] of participant.transports) {
      transportData.transport.close();
    }

    room.participants.delete(clientId);
    console.log(`Participant ${clientId} removed from room ${roomId}`);

    if (room.participants.size === 0) {
      room.router.close();
      this.rooms.delete(roomId);
      console.log(`Room ${roomId} closed`);
    }
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  setSpeakerPriority(roomId, speakerClientId) {
    const roomSpeakerData = this.speakerPriority.get(roomId) || {};
    roomSpeakerData.currentSpeaker = speakerClientId;
    this.speakerPriority.set(roomId, roomSpeakerData);
    console.log(`[SpeakerPriority] Speaker ${speakerClientId} set as priority in room ${roomId}`);
  }

  clearSpeakerPriority(roomId) {
    this.speakerPriority.delete(roomId);
    console.log(`[SpeakerPriority] Speaker priority cleared in room ${roomId}`);
  }

  getCurrentSpeaker(roomId) {
    const roomSpeakerData = this.speakerPriority.get(roomId);
    return roomSpeakerData?.currentSpeaker || null;
  }

  async forceSpeakerHighQuality(roomId, speakerClientId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      console.warn(`[SpeakerPriority] Room ${roomId} not found`);
      return false;
    }

    this.setSpeakerPriority(roomId, speakerClientId);

    const speakerProducerIds = this.getSpeakerProducerIds(roomId, speakerClientId);
    console.log(`[SpeakerPriority] Speaker ${speakerClientId} has producers:`, speakerProducerIds);

    const forcePromises = [];
    
    for (const [clientId, participant] of room.participants) {
      if (clientId === speakerClientId) continue;

      for (const [consumerId, consumerData] of participant.consumers) {
        if (speakerProducerIds.includes(consumerData.producerId)) {
          forcePromises.push(
            this.setConsumerPreferredLayersSmooth(
              roomId,
              clientId,
              consumerId,
              2,
              2
            ).catch(err => {
              console.warn(`[SpeakerPriority] Failed to set high quality for consumer ${consumerId}:`, err.message);
            })
          );
        }
      }
    }

    await Promise.all(forcePromises);
    console.log(`[SpeakerPriority] Forced high quality for speaker ${speakerClientId} to all subscribers`);
    return true;
  }

  async restoreAdaptiveQuality(roomId, excludedClientId = null) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    this.clearSpeakerPriority(roomId);

    console.log(`[SpeakerPriority] Restoring adaptive quality for all subscribers in room ${roomId}`);
    return true;
  }

  getSpeakerProducerIds(roomId, speakerClientId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const speaker = room.participants.get(speakerClientId);
    if (!speaker) return [];

    const producerIds = [];
    for (const [producerId, producerData] of speaker.producers) {
      producerIds.push(producerId);
    }
    return producerIds;
  }
}

module.exports = MediasoupManager;
