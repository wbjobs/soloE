const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('create-room', (roomId) => {
    socket.join(roomId);
    rooms.set(roomId, {
      host: socket.id,
      guest: null
    });
    console.log(`Room created: ${roomId} by ${socket.id}`);
    socket.emit('room-created', roomId);
  });

  socket.on('join-room', (roomId) => {
    const room = rooms.get(roomId);
    if (room && !room.guest) {
      socket.join(roomId);
      room.guest = socket.id;
      socket.emit('room-joined', roomId);
      socket.to(roomId).emit('guest-joined', socket.id);
      console.log(`Guest ${socket.id} joined room ${roomId}`);
    } else {
      socket.emit('room-full');
    }
  });

  socket.on('offer', (data) => {
    socket.to(data.roomId).emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.roomId).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.roomId).emit('ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    rooms.forEach((room, roomId) => {
      if (room.host === socket.id || room.guest === socket.id) {
        rooms.delete(roomId);
        socket.to(roomId).emit('peer-disconnected');
        console.log(`Room ${roomId} destroyed`);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});