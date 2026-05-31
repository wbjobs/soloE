const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e8
});

const rooms = new Map();
const relayFiles = new Map();

const TURN_CONFIG = {
  enabled: true,
  urls: [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
    'stun:stun4.l.google.com:19302'
  ],
  username: 'p2p-relay-user',
  credential: 'p2p-relay-pass-2024'
};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateFileId() {
  return crypto.randomBytes(8).toString('hex');
}

function getRoomPeer(socket, roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return room.users.find(id => id !== socket.id);
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('get-ice-servers', () => {
    socket.emit('ice-servers', {
      iceServers: TURN_CONFIG.urls.map(url => ({ urls: url }))
    });
  });

  socket.on('create-room', () => {
    const roomId = generateRoomId();
    rooms.set(roomId, {
      users: [socket.id],
      createdAt: Date.now(),
      useRelay: false,
      peerConnectionStates: {}
    });
    socket.join(roomId);
    socket.emit('room-created', { roomId, iceServers: TURN_CONFIG.urls });
    console.log(`Room ${roomId} created by ${socket.id}`);
  });

  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit('room-not-found');
      return;
    }

    if (room.users.length >= 2) {
      socket.emit('room-full');
      return;
    }

    room.users.push(socket.id);
    socket.join(roomId);
    socket.emit('room-joined', { roomId, iceServers: TURN_CONFIG.urls });
    
    socket.to(roomId).emit('user-joined');
    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  socket.on('peer-connection-state', ({ roomId, state }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.peerConnectionStates[socket.id] = state;
      console.log(`Room ${roomId}: Peer ${socket.id} state = ${state}`);
      
      if (state === 'failed' || state === 'disconnected') {
        const allFailed = room.users.every(
          userId => room.peerConnectionStates[userId] === 'failed' || 
                    room.peerConnectionStates[userId] === 'disconnected'
        );
        
        if (allFailed || room.users.length === 2) {
          room.useRelay = true;
          io.to(roomId).emit('enable-relay-mode');
          console.log(`Room ${roomId}: Enabling relay mode due to P2P connection failure`);
        }
      }
    }
  });

  socket.on('offer', ({ roomId, offer }) => {
    socket.to(roomId).emit('offer', offer);
  });

  socket.on('answer', ({ roomId, answer }) => {
    socket.to(roomId).emit('answer', answer);
  });

  socket.on('ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('ice-candidate', candidate);
  });

  socket.on('send-public-key', ({ roomId, publicKey }) => {
    const peerId = getRoomPeer(socket, roomId);
    if (peerId) {
      io.to(peerId).emit('peer-public-key', { publicKey });
      console.log(`Public key forwarded from ${socket.id} to ${peerId} in room ${roomId}`);
    }
  });

  socket.on('relay-file-info', ({ roomId, fileInfo }) => {
    const room = rooms.get(roomId);
    if (!room || !room.useRelay) return;

    const fileId = generateFileId();
    relayFiles.set(fileId, {
      ...fileInfo,
      fileId,
      senderId: socket.id,
      chunks: [],
      receivedChunks: 0,
      createdAt: Date.now()
    });

    socket.to(roomId).emit('relay-file-info', { ...fileInfo, fileId });
    console.log(`Relay: File ${fileInfo.name} (${fileId}) registered for room ${roomId}`);
  });

  socket.on('relay-file-chunk', ({ roomId, fileId, chunkIndex, data }) => {
    const room = rooms.get(roomId);
    if (!room || !room.useRelay) return;

    const fileData = relayFiles.get(fileId);
    if (fileData) {
      fileData.chunks[chunkIndex] = data;
      fileData.receivedChunks++;

      const progress = Math.round((fileData.receivedChunks / fileData.totalChunks) * 100);
      socket.to(roomId).emit('relay-file-progress', { fileId, progress });

      if (fileData.receivedChunks === fileData.totalChunks) {
        console.log(`Relay: File ${fileId} fully received, forwarding to peer`);
        fileData.chunks.forEach((chunk, idx) => {
          socket.to(roomId).emit('relay-file-chunk', {
            fileId,
            chunkIndex: idx,
            data: chunk
          });
        });
        socket.to(roomId).emit('relay-file-complete', { fileId });
      }
    }
  });

  socket.on('relay-file-complete', ({ roomId, fileId }) => {
    setTimeout(() => {
      relayFiles.delete(fileId);
      console.log(`Relay: File ${fileId} cleaned up`);
    }, 60000);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    for (const [roomId, room] of rooms.entries()) {
      const index = room.users.indexOf(socket.id);
      if (index !== -1) {
        room.users.splice(index, 1);
        if (room.users.length === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted`);
        } else {
          socket.to(roomId).emit('user-left');
        }
        break;
      }
    }
  });
});

app.get('/api/relay/status', (req, res) => {
  res.json({
    relayEnabled: true,
    activeRelayFiles: relayFiles.size,
    activeRooms: rooms.size,
    roomsWithRelay: Array.from(rooms.values()).filter(r => r.useRelay).length
  });
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'running', 
    activeRooms: rooms.size,
    totalUsers: io.engine.clientsCount,
    relayEnabled: true,
    turnServers: TURN_CONFIG.urls
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling + Relay server running on port ${PORT}`);
  console.log(`TURN/STUN servers configured: ${TURN_CONFIG.urls.length}`);
  console.log(`Relay mode: ENABLED (auto fallback when P2P fails)`);
});
