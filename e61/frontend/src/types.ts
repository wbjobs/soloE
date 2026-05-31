export interface Bookmark {
  time: number;
  label: string;
}

export interface Subtitle {
  startTime: number;
  endTime: number;
  text: string;
  speakerId?: string;
  speakerName?: string;
}

export interface Participant {
  id: string;
  name: string;
  color: string;
  connected: boolean;
}

export interface RoomState {
  roomId: string | null;
  participantId: string | null;
  participantName: string;
  participants: Participant[];
  isRecording: boolean;
  recordingStartTime: number;
  bookmarks: Bookmark[];
  subtitles: Subtitle[];
}

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  sessionId: string | null;
  duration: number;
  bookmarks: Bookmark[];
  subtitles: Subtitle[];
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}
