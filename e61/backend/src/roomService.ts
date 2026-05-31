import { RecordingSession, Participant, Subtitle, Bookmark } from './types';

const PARTICIPANT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4'
];

export class RoomService {
  private rooms: Map<string, RecordingSession> = new Map();

  createRoom(roomId: string, maxParticipants: number = 4): RecordingSession {
    const session: RecordingSession = {
      id: `session_${Date.now()}`,
      roomId,
      participants: new Map(),
      isRecording: false,
      startTime: 0,
      bookmarks: [],
      maxParticipants
    };
    this.rooms.set(roomId, session);
    return session;
  }

  getRoom(roomId: string): RecordingSession | undefined {
    return this.rooms.get(roomId);
  }

  joinRoom(roomId: string, participantId: string, name: string): Participant | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (room.participants.size >= room.maxParticipants) {
      return null;
    }

    const colorIndex = room.participants.size % PARTICIPANT_COLORS.length;
    const participant: Participant = {
      id: participantId,
      name,
      color: PARTICIPANT_COLORS[colorIndex],
      audioChunks: [],
      videoChunks: [],
      subtitles: [],
      connected: true
    };

    room.participants.set(participantId, participant);
    return participant;
  }

  leaveRoom(roomId: string, participantId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const participant = room.participants.get(participantId);
    if (participant) {
      participant.connected = false;
    }
    return true;
  }

  startRecording(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || room.isRecording) return false;

    room.isRecording = true;
    room.startTime = Date.now();
    return true;
  }

  stopRecording(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.isRecording) return false;

    room.isRecording = false;
    return true;
  }

  addAudioChunk(roomId: string, participantId: string, data: Buffer, timestamp: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const participant = room.participants.get(participantId);
    if (!participant) return false;

    participant.audioChunks.push({ data, timestamp });
    return true;
  }

  addVideoChunk(roomId: string, participantId: string, data: Buffer, timestamp: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const participant = room.participants.get(participantId);
    if (!participant) return false;

    participant.videoChunks.push({ data, timestamp });
    return true;
  }

  addSubtitle(roomId: string, participantId: string, subtitle: Subtitle): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const participant = room.participants.get(participantId);
    if (!participant) return false;

    subtitle.speakerId = participantId;
    subtitle.speakerName = participant.name;
    participant.subtitles.push(subtitle);
    return true;
  }

  addBookmark(roomId: string, bookmark: Bookmark): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    room.bookmarks.push(bookmark);
    return true;
  }

  getParticipants(roomId: string): Participant[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return Array.from(room.participants.values());
  }

  mergeAllSubtitles(roomId: string): Subtitle[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    const allSubtitles: Subtitle[] = [];
    room.participants.forEach(participant => {
      allSubtitles.push(...participant.subtitles);
    });

    return allSubtitles.sort((a, b) => a.startTime - b.startTime);
  }

  deleteRoom(roomId: string): boolean {
    return this.rooms.delete(roomId);
  }

  getActiveRooms(): string[] {
    return Array.from(this.rooms.keys());
  }
}
