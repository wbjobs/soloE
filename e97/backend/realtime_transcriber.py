import asyncio
import numpy as np
import io
import wave
from collections import deque
from typing import Deque, List, Dict, Any, Optional
from pydub import AudioSegment

from audio_processor import audio_processor


class RealtimeSession:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.audio_buffer: Deque[bytes] = deque()
        self.full_transcript: str = ""
        self.segments: List[Dict[str, Any]] = []
        self.is_processing: bool = False
        self.last_processed_time: float = 0.0
        self.sample_rate: int = 16000
        self.channels: int = 1
        self.sample_width: int = 2
        self.buffer_seconds: float = 3.0
        self.process_interval: float = 2.0
        self.audio_data = io.BytesIO()
        self._wav_writer = None
        self._init_wav_writer()

    def _init_wav_writer(self):
        self._wav_writer = wave.open(self.audio_data, 'wb')
        self._wav_writer.setnchannels(self.channels)
        self._wav_writer.setsampwidth(self.sample_width)
        self._wav_writer.setframerate(self.sample_rate)

    def add_audio(self, audio_bytes: bytes):
        self.audio_buffer.append(audio_bytes)
        try:
            self._wav_writer.writeframes(audio_bytes)
        except Exception as e:
            print(f"Error writing audio frames: {e}")

    async def process_buffer(self) -> Optional[Dict[str, Any]]:
        if len(self.audio_buffer) == 0 or self.is_processing:
            return None

        self.is_processing = True
        try:
            temp_audio = io.BytesIO()
            with wave.open(temp_audio, 'wb') as wf:
                wf.setnchannels(self.channels)
                wf.setsampwidth(self.sample_width)
                wf.setframerate(self.sample_rate)
                while self.audio_buffer:
                    wf.writeframes(self.audio_buffer.popleft())

            temp_audio.seek(0)
            temp_path = f"temp_{self.session_id}.wav"
            with open(temp_path, 'wb') as f:
                f.write(temp_audio.getvalue())

            try:
                text, segments = audio_processor.transcribe_with_faster_whisper(temp_path)
                
                if text.strip():
                    self.full_transcript += text + " "
                    self.segments.extend(segments)
                    
                    return {
                        "text": text,
                        "full_text": self.full_transcript.strip(),
                        "segments": segments,
                        "is_final": False
                    }
            finally:
                import os
                if os.path.exists(temp_path):
                    os.unlink(temp_path)

        except Exception as e:
            print(f"Error processing audio buffer: {e}")
        finally:
            self.is_processing = False

        return None

    def finalize(self) -> Dict[str, Any]:
        return {
            "full_text": self.full_transcript.strip(),
            "segments": self.segments,
            "session_id": self.session_id
        }

    def get_current_transcript(self) -> str:
        return self.full_transcript.strip()


class RealtimeTranscriber:
    def __init__(self):
        self.sessions: Dict[str, RealtimeSession] = {}

    def create_session(self, session_id: str) -> RealtimeSession:
        session = RealtimeSession(session_id)
        self.sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[RealtimeSession]:
        return self.sessions.get(session_id)

    def remove_session(self, session_id: str):
        if session_id in self.sessions:
            del self.sessions[session_id]


realtime_transcriber = RealtimeTranscriber()
