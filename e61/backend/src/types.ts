export interface Bookmark {
  time: number;
  label: string;
}

export interface MediaChunk {
  data: Buffer;
  timestamp: number;
}

export interface Participant {
  id: string;
  name: string;
  color: string;
  audioChunks: MediaChunk[];
  videoChunks: MediaChunk[];
  subtitles: Subtitle[];
  connected: boolean;
}

export interface RecordingSession {
  id: string;
  roomId: string;
  participants: Map<string, Participant>;
  isRecording: boolean;
  startTime: number;
  bookmarks: Bookmark[];
  maxParticipants: number;
}

export interface Subtitle {
  startTime: number;
  endTime: number;
  text: string;
  speakerId?: string;
  speakerName?: string;
}

export interface WebSocketMessage {
  type: string;
  data: any;
  sessionId?: string;
  roomId?: string;
  participantId?: string;
}
