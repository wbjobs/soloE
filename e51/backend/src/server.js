const express = require('express');
const https = require('https');
const fs = require('fs');
const socketIO = require('socket.io');
const mediasoup = require('mediasoup');
const config = require('./config');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const options = {
  pfx: fs.readFileSync('../certs/cert.pfx'),
  passphrase: 'password'
};

const httpsServer = https.createServer(options, app);

const io = socketIO(httpsServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let mediasoupWorker;
let rooms = new Map();

async function createMediasoupWorker() {
  const worker = await mediasoup.createWorker(config.mediasoup.worker);
  console.log('Mediasoup worker created, PID:', worker.pid);
  
  worker.on('died', () => {
    console.error('Mediasoup worker died, exiting in 2 seconds...');
    setTimeout(() => process.exit(1), 2000);
  });
  
  return worker;
}

async function createRoom(roomId) {
  if (rooms.has(roomId)) {
    return rooms.get(roomId);
  }
  
  const router = await mediasoupWorker.createRouter(config.mediasoup.router);
  
  const room = {
    id: roomId,
    router: router,
    peers: new Map(),
    maxPeers: 6
  };
  
  rooms.set(roomId, room);
  console.log('Room created:', roomId);
  return room;
}

async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport(config.mediasoup.webRtcTransport);
  
  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'closed') {
      transport.close();
    }
  });
  
  return transport;
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  let currentRoom = null;
  let peerId = null;
  let sendTransport = null;
  let recvTransport = null;
  let producers = new Map();
  let consumers = new Map();
  
  socket.on('join-room', async ({ roomId, peerName }, callback) => {
    try {
      const room = await createRoom(roomId);
      
      if (room.peers.size >= room.maxPeers) {
        callback({ success: false, error: 'Room is full' });
        return;
      }
      
      currentRoom = room;
      peerId = socket.id;
      
      const peerInfo = {
        id: peerId,
        name: peerName,
        producers: []
      };
      
      room.peers.set(peerId, peerInfo);
      
      const rtpCapabilities = room.router.rtpCapabilities;
      const existingPeers = Array.from(room.peers.values())
        .filter(p => p.id !== peerId)
        .map(p => ({ id: p.id, name: p.name, producers: p.producers }));
      
      socket.join(roomId);
      
      socket.to(roomId).emit('peer-joined', {
        id: peerId,
        name: peerName
      });
      
      callback({
        success: true,
        rtpCapabilities,
        peers: existingPeers
      });
      
      console.log('Peer joined room:', roomId, peerName);
    } catch (error) {
      console.error('Join room error:', error);
      callback({ success: false, error: error.message });
    }
  });
  
  socket.on('create-send-transport', async (_, callback) => {
    try {
      if (!currentRoom) throw new Error('Not in a room');
      
      sendTransport = await createWebRtcTransport(currentRoom.router);
      
      callback({
        id: sendTransport.id,
        iceParameters: sendTransport.iceParameters,
        iceCandidates: sendTransport.iceCandidates,
        dtlsParameters: sendTransport.dtlsParameters
      });
    } catch (error) {
      console.error('Create send transport error:', error);
      callback({ error: error.message });
    }
  });
  
  socket.on('create-recv-transport', async (_, callback) => {
    try {
      if (!currentRoom) throw new Error('Not in a room');
      
      recvTransport = await createWebRtcTransport(currentRoom.router);
      
      callback({
        id: recvTransport.id,
        iceParameters: recvTransport.iceParameters,
        iceCandidates: recvTransport.iceCandidates,
        dtlsParameters: recvTransport.dtlsParameters
      });
    } catch (error) {
      console.error('Create recv transport error:', error);
      callback({ error: error.message });
    }
  });
  
  socket.on('connect-transport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      const transport = (sendTransport?.id === transportId) ? sendTransport : recvTransport;
      if (!transport) throw new Error('Transport not found');
      
      await transport.connect({ dtlsParameters });
      callback({ success: true });
    } catch (error) {
      console.error('Connect transport error:', error);
      callback({ success: false, error: error.message });
    }
  });
  
  socket.on('produce', async ({ kind, rtpParameters }, callback) => {
    try {
      if (!sendTransport) throw new Error('Send transport not found');
      if (!currentRoom) throw new Error('Not in a room');
      
      const producer = await sendTransport.produce({ kind, rtpParameters });
      producers.set(producer.id, producer);
      
      const peer = currentRoom.peers.get(peerId);
      peer.producers.push({
        id: producer.id,
        kind
      });
      
      socket.to(currentRoom.id).emit('new-producer', {
        peerId: peerId,
        producerId: producer.id,
        kind
      });
      
      producer.on('score', (score) => {
        socket.emit('producer-score', {
          producerId: producer.id,
          score
        });
      });
      
      callback({ id: producer.id });
    } catch (error) {
      console.error('Produce error:', error);
      callback({ error: error.message });
    }
  });
  
  socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
    try {
      if (!recvTransport) throw new Error('Recv transport not found');
      if (!currentRoom) throw new Error('Not in a room');
      
      if (!currentRoom.router.canConsume({ producerId, rtpCapabilities })) {
        callback({ error: 'Cannot consume' });
        return;
      }
      
      const consumer = await recvTransport.consume({
        producerId,
        rtpCapabilities,
        paused: false
      });
      
      consumers.set(consumer.id, consumer);
      
      consumer.on('producerpause', () => {
        socket.emit('consumer-paused', { consumerId: consumer.id });
      });
      
      consumer.on('producerresume', () => {
        socket.emit('consumer-resumed', { consumerId: consumer.id });
      });
      
      consumer.on('score', (score) => {
        socket.emit('consumer-score', {
          consumerId: consumer.id,
          score
        });
      });
      
      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      });
    } catch (error) {
      console.error('Consume error:', error);
      callback({ error: error.message });
    }
  });
  
  socket.on('resume-consumer', async ({ consumerId }, callback) => {
    try {
      const consumer = consumers.get(consumerId);
      if (!consumer) throw new Error('Consumer not found');
      
      await consumer.resume();
      callback({ success: true });
    } catch (error) {
      console.error('Resume consumer error:', error);
      callback({ success: false, error: error.message });
    }
  });
  
  socket.on('close-producer', async ({ producerId }, callback) => {
    try {
      const producer = producers.get(producerId);
      if (producer) {
        producer.close();
        producers.delete(producerId);
        
        if (currentRoom) {
          const peer = currentRoom.peers.get(peerId);
          peer.producers = peer.producers.filter(p => p.id !== producerId);
          
          socket.to(currentRoom.id).emit('producer-closed', {
            peerId,
            producerId
          });
        }
      }
      callback({ success: true });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  socket.on('transport-state-change', async ({ transportId, state }) => {
    console.log(`Transport ${transportId} state changed: ${state}`);
    
    if (state === 'disconnected' || state === 'failed') {
      socket.emit('ice-state-change', { state });
      
      if (currentRoom) {
        socket.to(currentRoom.id).emit('network-switch-detected');
      }
    }
  });

  socket.on('network-switch', async ({ peerId, timestamp }) => {
    console.log(`Network switch detected from peer ${peerId} at ${timestamp}`);
    
    if (currentRoom) {
      socket.to(currentRoom.id).emit('network-switch-detected');
      
      setTimeout(async () => {
        try {
          const videoProducer = Array.from(producers.values()).find(p => p.kind === 'video');
          if (videoProducer) {
            const stats = await videoProducer.getStats();
            stats.forEach((report) => {
              if (report.type === 'outbound-rtp') {
                const bitrate = report.bitrate || report.targetBitrate || 500000;
                socket.emit('bitrate-estimation', { bitrate, timestamp: Date.now() });
              }
            });
          }
        } catch (e) {
          console.warn('Failed to get producer stats:', e);
        }
      }, 500);
    }
  });

  socket.on('ice-restart', async ({ transportId, peerId }) => {
    console.log('ICE restart requested for transport:', transportId);
    
    try {
      const transport = (sendTransport?.id === transportId) ? sendTransport : 
                       (recvTransport?.id === transportId ? recvTransport : null);
      
      if (transport) {
        await transport.restartIce();
        console.log('ICE restarted for transport:', transportId);
      }
    } catch (error) {
      console.error('ICE restart failed:', error);
    }
  });

  socket.on('speaker-active', async ({ peerId, peerName, roomId }) => {
    console.log('Speaker active:', peerName, 'in room:', roomId);
    
    const room = rooms.get(roomId);
    if (!room) return;

    if (!room.speakers) {
      room.speakers = new Map();
    }

    room.speakers.set(peerId, {
      name: peerName,
      activeSince: Date.now(),
      priority: 10
    });

    await adjustSpeakerBitrate(room, peerId, true);

    socket.to(roomId).emit('speaker-broadcast', {
      peerId,
      peerName,
      isActive: true
    });
  });

  socket.on('set-speaker-priority', async ({ peerId, priorityLevel, roomId }) => {
    console.log('Set speaker priority:', peerId, 'level:', priorityLevel);
    
    const room = rooms.get(roomId);
    if (!room || !room.speakers) return;

    const speakerInfo = room.speakers.get(peerId);
    if (speakerInfo) {
      speakerInfo.priority = priorityLevel;
      await adjustSpeakerBitrate(room, peerId, priorityLevel > 5);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    producers.forEach(producer => producer.close());
    consumers.forEach(consumer => consumer.close());
    
    if (sendTransport) sendTransport.close();
    if (recvTransport) recvTransport.close();
    
    if (currentRoom && peerId) {
      currentRoom.peers.delete(peerId);
      socket.to(currentRoom.id).emit('peer-left', { peerId });
      
      if (currentRoom.peers.size === 0) {
        currentRoom.router.close();
        rooms.delete(currentRoom.id);
        console.log('Room closed:', currentRoom.id);
      }
    }
  });
});

async function adjustSpeakerBitrate(room, speakerPeerId, isSpeaker) {
  try {
    const peerProducers = [];
    
    room.peers.forEach((peer, peerId) => {
      if (peer.producers) {
        peer.producers.forEach(producerInfo => {
          peerProducers.push({ peerId, producerId: producerInfo.id, kind: producerInfo.kind });
        });
      }
    });

    for (const { peerId, producerId, kind } of peerProducers) {
      const producer = producers.get(producerId);
      if (!producer) continue;

      if (kind === 'video') {
        if (isSpeaker && speakerPeerId === peerId) {
          await producer.setMaxBitrate(3000000);
          console.log('Set high bitrate (3Mbps) for speaker video:', producerId);
        } else {
          await producer.setMaxBitrate(800000);
          console.log('Set low bitrate (0.8Mbps) for non-speaker video:', producerId);
        }
      }
    }
  } catch (error) {
    console.error('Failed to adjust speaker bitrate:', error);
  }
}

async function startServer() {
  mediasoupWorker = await createMediasoupWorker();
  
  httpsServer.listen(config.httpsPort, () => {
    console.log(`HTTPS server running on https://localhost:${config.httpsPort}`);
  });
}

startServer();