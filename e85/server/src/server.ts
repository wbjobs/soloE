import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { DatabaseService } from './database';
import { SignalingMessage, DetectionReport, DecodingLog } from './types';

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

const db = new DatabaseService();

interface SocketMap {
  [socketId: string]: {
    peerId: string;
    roomId: string;
  };
}

const socketMap: SocketMap = {};
const roomPeers: { [roomId: string]: string[] } = {};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', ({ roomId, peerId }: { roomId: string; peerId: string }) => {
    socket.join(roomId);
    socketMap[socket.id] = { peerId, roomId };

    if (!roomPeers[roomId]) {
      roomPeers[roomId] = [];
    }
    if (!roomPeers[roomId].includes(peerId)) {
      roomPeers[roomId].push(peerId);
    }

    const peersInRoom = roomPeers[roomId].filter((p) => p !== peerId);
    socket.emit('room-peers', peersInRoom);
    socket.to(roomId).emit('peer-joined', peerId);

    console.log(`Peer ${peerId} joined room ${roomId}. Peers in room:`, roomPeers[roomId]);
  });

  socket.on('signal', (message: SignalingMessage) => {
    const targetPeer = Object.entries(socketMap).find(
      ([_, info]) => info.peerId === message.to && info.roomId === message.from
    );

    if (targetPeer) {
      socket.to(targetPeer[0]).emit('signal', message);
    } else {
      socket.to(message.to).emit('signal', message);
    }
  });

  socket.on('detection-report', (report: Omit<DetectionReport, 'id'>) => {
    try {
      const id = db.saveReport(report);
      console.log(`Saved detection report #${id} with suspicion: ${report.overallSuspicion.toFixed(2)}`);
      socket.emit('report-saved', { id, ...report });

      if (report.overallSuspicion >= 0.7) {
        const roomInfo = socketMap[socket.id];
        if (roomInfo) {
          socket.to(roomInfo.roomId).emit('high-suspicion-alert', report);
        }
      }
    } catch (err) {
      console.error('Failed to save report:', err);
      socket.emit('report-error', err);
    }
  });

  socket.on('decoding-log', (log: Omit<DecodingLog, 'id'>) => {
    try {
      const id = db.saveDecodingLog(log);
      console.log(`Saved decoding log #${id}, success: ${log.decodingSuccess}, confidence: ${log.confidence.toFixed(2)}`);
      socket.emit('decoding-log-saved', { id, ...log });
    } catch (err) {
      console.error('Failed to save decoding log:', err);
      socket.emit('decoding-log-error', err);
    }
  });

  socket.on('disconnect', () => {
    const info = socketMap[socket.id];
    if (info) {
      socket.to(info.roomId).emit('peer-left', info.peerId);
      if (roomPeers[info.roomId]) {
        roomPeers[info.roomId] = roomPeers[info.roomId].filter((p) => p !== info.peerId);
        if (roomPeers[info.roomId].length === 0) {
          delete roomPeers[info.roomId];
        }
      }
      delete socketMap[socket.id];
      console.log(`Peer ${info.peerId} disconnected from room ${info.roomId}`);
    }
  });
});

app.get('/api/reports', (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    const suspicious = req.query.suspicious === 'true';
    const threshold = parseFloat(req.query.threshold as string) || 0.7;

    let reports: DetectionReport[];
    if (suspicious) {
      reports = db.getSuspiciousReports(threshold);
    } else if (sessionId) {
      reports = db.getReportsBySession(sessionId);
    } else {
      reports = db.getAllReports();
    }
    res.json(reports);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/decoding-logs', (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    const successful = req.query.successful === 'true';

    let logs: DecodingLog[];
    if (successful) {
      logs = db.getSuccessfulDecodings(100);
    } else if (sessionId) {
      logs = db.getDecodingLogsBySession(sessionId);
    } else {
      logs = db.getSuccessfulDecodings(100);
    }
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', connectedClients: io.engine.clientsCount });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
