const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const MediasoupManager = require('./mediasoup/MediasoupManager');
const BitrateAdaptation = require('./adaptation/BitrateAdaptation');
const SpeakerDetector = require('./audio/SpeakerDetector');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const mediasoupManager = new MediasoupManager();
const bitrateAdaptation = new BitrateAdaptation();
const speakerDetector = new SpeakerDetector();

const MAX_PARTICIPANTS_PER_ROOM = 4;
const clientSwitchingStates = new Map();
const clientNames = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('joinRoom', async ({ roomId, clientName }, callback) => {
    try {
      await mediasoupManager.createRoom(roomId);
      speakerDetector.initializeRoom(roomId);
      const room = mediasoupManager.getRoom(roomId);

      if (room.participants.size >= MAX_PARTICIPANTS_PER_ROOM) {
        return callback({ error: 'Room is full' });
      }

      socket.join(roomId);
      socket.roomId = roomId;
      socket.clientName = clientName;
      clientNames.set(socket.id, clientName);

      bitrateAdaptation.initializeClient(socket.id);
      speakerDetector.addParticipant(roomId, socket.id, clientName);

      const routerRtpCapabilities = room.router.rtpCapabilities;
      const participants = mediasoupManager.getRoomParticipants(roomId);
      const currentSpeaker = speakerDetector.getCurrentSpeaker(roomId);

      socket.to(roomId).emit('newParticipantJoined', {
        clientId: socket.id,
        clientName
      });

      callback({
        routerRtpCapabilities,
        participants,
        currentSpeaker
      });
    } catch (error) {
        console.error('joinRoom error:', error);
        callback({ error: error.message });
      }
  });

  socket.on('createWebRtcTransport', async ({ direction }, callback) => {
    try {
      const roomId = socket.roomId;
      if (!roomId) {
        return callback({ error: 'Not in a room' });
      }

      const transport = await mediasoupManager.createWebRtcTransport(
        roomId,
        socket.id,
        direction
      );

      callback({ transport });
    } catch (error) {
      console.error('createWebRtcTransport error:', error);
      callback({ error: error.message });
    }
  });

  socket.on('connectTransport', async ({ transportId, dtlsParameters, direction }, callback) => {
    try {
      const roomId = socket.roomId;
      if (!roomId) {
        return callback({ error: 'Not in a room' });
      }

      await mediasoupManager.connectTransport(
        roomId,
        socket.id,
        transportId,
        dtlsParameters
      );

      callback({ success: true });
    } catch (error) {
      console.error('connectTransport error:', error);
      callback({ error: error.message });
    }
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }, callback) => {
    try {
      const roomId = socket.roomId;
      if (!roomId) {
        return callback({ error: 'Not in a room' });
      }

      const producer = await mediasoupManager.createProducer(
        roomId,
        socket.id,
        transportId,
        kind,
        rtpParameters
      );

      socket.to(roomId).emit('newProducer', {
        clientId: socket.id,
        producerId: producer.id,
        kind
      });

      callback({ producerId: producer.id });
    } catch (error) {
      console.error('produce error:', error);
      callback({ error: error.message });
    }
  });

  socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
    try {
      const roomId = socket.roomId;
      if (!roomId) {
        return callback({ error: 'Not in a room' });
      }

      const consumer = await mediasoupManager.createConsumer(
        roomId,
        socket.id,
        producerId,
        rtpCapabilities
      );

      const qualityConfig = bitrateAdaptation.getQualityLayerConfig(socket.id);
      await mediasoupManager.setConsumerPreferredLayersSmooth(
        roomId,
        socket.id,
        consumer.id,
        qualityConfig.spatialLayer,
        qualityConfig.temporalLayer
      );

      callback({ consumer });
    } catch (error) {
      console.error('consume error:', error);
      callback({ error: error.message });
    }
  });

  async function updateConsumerLayersSmooth(roomId, clientId, targetLayer) {
    const isSwitching = clientSwitchingStates.get(clientId);
    if (isSwitching) {
      console.log(`[LayerSwitch] Skip: client ${clientId} is already switching layers`);
      return;
    }

    clientSwitchingStates.set(clientId, true);
    
    try {
      const qualityConfig = bitrateAdaptation.qualityLayers[targetLayer];
      const room = mediasoupManager.getRoom(roomId);
      
      if (!room) return;

      const participant = room.participants.get(clientId);
      if (!participant) return;

      const currentLayer = bitrateAdaptation.getQualityLayer(clientId);
      const layerOrder = ['low', 'medium', 'high'];
      const isDowngrading = layerOrder.indexOf(targetLayer) < layerOrder.indexOf(currentLayer);

      if (!isDowngrading) {
        const producerIds = new Set();
        for (const [, consumerData] of participant.consumers) {
          producerIds.add(consumerData.producerId);
        }
        for (const producerId of producerIds) {
          await mediasoupManager.requestProducerKeyFrame(roomId, producerId);
        }
        await mediasoupManager.delay(50);
      }

      const promises = [];
      for (const [consumerId, consumerData] of participant.consumers) {
        promises.push(
          mediasoupManager.setConsumerPreferredLayersSmooth(
            roomId,
            clientId,
            consumerId,
            qualityConfig.spatialLayer,
            qualityConfig.temporalLayer
          )
        );
      }

      await Promise.all(promises);
      
      bitrateAdaptation.confirmLayerChange(clientId);
      console.log(`[LayerSwitch] Successfully switched client ${clientId} to layer: ${targetLayer}`);
    } catch (error) {
      console.error(`[LayerSwitch] Error switching layers for client ${clientId}:`, error);
    } finally {
      clientSwitchingStates.set(clientId, false);
    }
  }

  socket.on('networkStats', async ({ rtt, packetLoss, bitrate }) => {
    try {
      const roomId = socket.roomId;
      if (!roomId) return;

      const currentSpeaker = mediasoupManager.getCurrentSpeaker(roomId);
      
      if (currentSpeaker && currentSpeaker !== socket.id) {
        return;
      }

      const newLayer = bitrateAdaptation.updateClientStats(socket.id, {
        rtt,
        packetLoss,
        bitrate
      });

      const currentLayer = bitrateAdaptation.getQualityLayer(socket.id);
      if (newLayer !== currentLayer) {
        await updateConsumerLayersSmooth(roomId, socket.id, newLayer);
      }
    } catch (error) {
      console.error('networkStats error:', error);
      clientSwitchingStates.set(socket.id, false);
    }
  });

  socket.on('setProducerBitrate', async ({ producerId, bitrate }) => {
    socket.to(socket.roomId).emit('producerBitrateChanged', {
      clientId: socket.id,
      producerId,
      bitrate
    });
  });

  socket.on('audioVolume', async ({ volume }) => {
    const roomId = socket.roomId;
    if (!roomId) return;

    try {
      const result = speakerDetector.updateVolume(roomId, socket.id, volume);
      
      if (result) {
        if (result.action === 'new') {
          console.log(`[SpeakerMode] New speaker detected: ${result.speakerName}`);
          
          await mediasoupManager.forceSpeakerHighQuality(roomId, result.speakerId);
          
          io.to(roomId).emit('speakerChanged', {
            speakerId: result.speakerId,
            speakerName: result.speakerName,
            previousSpeaker: result.previousSpeaker,
            isSpeakerMode: true
          });
        } else if (result.action === 'clear') {
          console.log(`[SpeakerMode] Speaker cleared due to silence`);
          
          await mediasoupManager.restoreAdaptiveQuality(roomId);
          
          io.to(roomId).emit('speakerChanged', {
            speakerId: null,
            speakerName: null,
            previousSpeaker: result.previousSpeaker,
            isSpeakerMode: false
          });
        }
      }
    } catch (error) {
      console.error('Error processing audio volume:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const roomId = socket.roomId;
    if (roomId) {
      const currentSpeaker = speakerDetector.getCurrentSpeaker(roomId);
      
      speakerDetector.removeParticipant(roomId, socket.id);
      
      if (currentSpeaker && currentSpeaker.clientId === socket.id) {
        mediasoupManager.restoreAdaptiveQuality(roomId);
        io.to(roomId).emit('speakerChanged', {
          speakerId: null,
          speakerName: null,
          previousSpeaker: socket.id,
          isSpeakerMode: false
        });
      }
      
      socket.to(roomId).emit('participantLeft', { clientId: socket.id });
      mediasoupManager.removeParticipant(roomId, socket.id);
      bitrateAdaptation.removeClient(socket.id);
      clientSwitchingStates.delete(socket.id);
      clientNames.delete(socket.id);
    }
  });
});

async function startServer() {
  try {
    await mediasoupManager.initializeWorkers(2);
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
