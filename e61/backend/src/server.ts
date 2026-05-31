import express from 'express';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { RoomService } from './roomService';
import { MultiTrackService } from './multiTrackService';
import { WhisperService } from './whisperService';
import { WebSocketMessage } from './types';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use('/recordings', express.static(path.join(__dirname, '../recordings')));

const roomService = new RoomService();
const multiTrackService = new MultiTrackService();
const whisperService = new WhisperService();

const clients = new Map<string, { ws: WebSocket; roomId: string; participantId: string }>();

wss.on('connection', (ws: WebSocket) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  ws.on('message', async (data: WebSocket.Data) => {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      await handleMessage(ws, clientId, message);
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    const client = clients.get(clientId);
    if (client) {
      roomService.leaveRoom(client.roomId, client.participantId);
      broadcastToRoom(client.roomId, {
        type: 'participant-left',
        data: { participantId: client.participantId }
      });
      clients.delete(clientId);
    }
  });
});

async function handleMessage(ws: WebSocket, clientId: string, message: WebSocketMessage) {
  const { type, data, roomId, participantId } = message;

  switch (type) {
    case 'create-room':
      await handleCreateRoom(ws, clientId, data);
      break;
    case 'join-room':
      await handleJoinRoom(ws, clientId, data);
      break;
    case 'leave-room':
      await handleLeaveRoom(ws, clientId, data);
      break;
    case 'start-recording':
      await handleStartRecording(ws, roomId!);
      break;
    case 'audio-chunk':
      await handleAudioChunk(roomId!, participantId!, data);
      break;
    case 'video-chunk':
      await handleVideoChunk(roomId!, participantId!, data);
      break;
    case 'subtitle':
      await handleSubtitle(roomId!, participantId!, data);
      break;
    case 'add-bookmark':
      await handleAddBookmark(ws, roomId!, data);
      break;
    case 'stop-recording':
      await handleStopRecording(ws, roomId!);
      break;
  }
}

async function handleCreateRoom(ws: WebSocket, clientId: string, data: any) {
  const roomId = data.roomId || `room_${Date.now()}`;
  const maxParticipants = data.maxParticipants || 4;

  roomService.createRoom(roomId, maxParticipants);

  ws.send(JSON.stringify({
    type: 'room-created',
    data: { roomId, maxParticipants }
  }));
}

async function handleJoinRoom(ws: WebSocket, clientId: string, data: any) {
  const { roomId, participantName } = data;
  const participantId = `participant_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  const room = roomService.getRoom(roomId);
  if (!room) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Room not found' }
    }));
    return;
  }

  const participant = roomService.joinRoom(roomId, participantId, participantName);
  if (!participant) {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Room is full' }
    }));
    return;
  }

  clients.set(clientId, { ws, roomId, participantId });

  ws.send(JSON.stringify({
    type: 'joined-room',
    data: {
      roomId,
      participantId,
      participantName,
      color: participant.color,
      participants: roomService.getParticipants(roomId)
    }
  }));

  broadcastToRoom(roomId, {
    type: 'participant-joined',
    data: participant
  });
}

async function handleLeaveRoom(ws: WebSocket, clientId: string, data: any) {
  const { roomId, participantId } = data;
  roomService.leaveRoom(roomId, participantId);
  clients.delete(clientId);

  broadcastToRoom(roomId, {
    type: 'participant-left',
    data: { participantId }
  });
}

async function handleStartRecording(ws: WebSocket, roomId: string) {
  const success = roomService.startRecording(roomId);

  if (success) {
    broadcastToRoom(roomId, {
      type: 'recording-started',
      data: { startTime: Date.now() }
    });
  } else {
    ws.send(JSON.stringify({
      type: 'error',
      data: { message: 'Failed to start recording' }
    }));
  }
}

async function handleAudioChunk(roomId: string, participantId: string, data: any) {
  const audioBuffer = Buffer.from(data.audio, 'base64');
  roomService.addAudioChunk(roomId, participantId, audioBuffer, data.timestamp);
}

async function handleVideoChunk(roomId: string, participantId: string, data: any) {
  const videoBuffer = Buffer.from(data.video, 'base64');
  roomService.addVideoChunk(roomId, participantId, videoBuffer, data.timestamp);
}

async function handleSubtitle(roomId: string, participantId: string, data: any) {
  roomService.addSubtitle(roomId, participantId, data.subtitle);

  const participants = roomService.getParticipants(roomId);
  const participant = participants.find(p => p.id === participantId);

  if (participant) {
    broadcastToRoom(roomId, {
      type: 'subtitle-update',
      data: {
        ...data.subtitle,
        speakerId: participantId,
        speakerName: participant.name
      }
    });
  }
}

async function handleAddBookmark(ws: WebSocket, roomId: string, data: any) {
  roomService.addBookmark(roomId, data.bookmark);

  broadcastToRoom(roomId, {
    type: 'bookmark-added',
    data: data.bookmark
  });
}

async function handleStopRecording(ws: WebSocket, roomId: string) {
  const room = roomService.getRoom(roomId);
  if (!room) return;

  roomService.stopRecording(roomId);

  try {
    const timestamp = Date.now();
    const recordingsDir = path.join(__dirname, '../recordings');
    const participants = roomService.getParticipants(roomId);

    const mixedAudioPath = path.join(recordingsDir, `${timestamp}_mixed_audio.aac`);
    const pipVideoPath = path.join(recordingsDir, `${timestamp}_pip_video.mp4`);
    const outputPath = path.join(recordingsDir, `${timestamp}_final_output.mp4`);
    const srtPath = path.join(recordingsDir, `${timestamp}_subtitles.srt`);

    await multiTrackService.mergeMultiTrackAudio(participants, mixedAudioPath);

    await multiTrackService.createPictureInPictureVideo(participants, pipVideoPath);

    const mergedSubtitles = roomService.mergeAllSubtitles(roomId);

    await multiTrackService.mergeAudioVideoWithSubtitles(
      pipVideoPath,
      mixedAudioPath,
      outputPath,
      mergedSubtitles
    );

    const srtContent = multiTrackService.generateSpeakerSubtitlesSRT(mergedSubtitles);
    fs.writeFileSync(srtPath, srtContent);

    try {
      fs.unlinkSync(mixedAudioPath);
      fs.unlinkSync(pipVideoPath);
    } catch { }

    const downloadUrl = `/recordings/${timestamp}_final_output.mp4`;
    const subtitlesUrl = `/recordings/${timestamp}_subtitles.srt`;

    broadcastToRoom(roomId, {
      type: 'recording-completed',
      data: {
        videoUrl: downloadUrl,
        subtitlesUrl,
        bookmarks: room.bookmarks,
        subtitles: mergedSubtitles,
        participants: participants.map(p => ({ id: p.id, name: p.name, color: p.color }))
      }
    });

    roomService.deleteRoom(roomId);
  } catch (error) {
    console.error('Error processing multi-track recording:', error);
    broadcastToRoom(roomId, {
      type: 'recording-error',
      data: { error: 'Failed to process recording' }
    });
  }
}

function broadcastToRoom(roomId: string, message: any) {
  clients.forEach((client) => {
    if (client.roomId === roomId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  });
}

app.get('/api/rooms', (req, res) => {
  res.json(roomService.getActiveRooms());
});

app.get('/api/rooms/:roomId/participants', (req, res) => {
  const participants = roomService.getParticipants(req.params.roomId);
  res.json(participants);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready for multi-track recording`);
});
