import os
import numpy as np
import tempfile
import torch
import torch.nn.functional as F
from pydub import AudioSegment
from typing import List, Dict, Any, Tuple, Optional
from faster_whisper import WhisperModel

from config import settings


class AudioProcessor:
    def __init__(self):
        self.whisper_model = None
        self.vad_model = None
        self.speaker_embedding_model = None
        self._load_models()

    def _load_models(self):
        try:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            if settings.WHISPER_DEVICE != "auto":
                device = settings.WHISPER_DEVICE

            compute_type = settings.WHISPER_COMPUTE_TYPE
            self.whisper_model = WhisperModel(
                settings.WHISPER_MODEL,
                device=device,
                compute_type=compute_type
            )
            print(f"Faster-Whisper model '{settings.WHISPER_MODEL}' loaded on {device} with {compute_type}")
        except Exception as e:
            print(f"Failed to load Faster-Whisper model: {e}")
            self.whisper_model = None

        try:
            if settings.USE_PYANNOTE and settings.PYANNOTE_AUTH_TOKEN:
                from pyannote.audio import Model, Inference
                self.speaker_embedding_model = Inference(
                    "pyannote/embedding",
                    use_auth_token=settings.PYANNOTE_AUTH_TOKEN
                )
                print("Pyannote speaker embedding model loaded")
            else:
                print("Pyannote not enabled, using fallback speaker clustering")
                self.speaker_embedding_model = None
        except Exception as e:
            print(f"Failed to load pyannote models: {e}")
            self.speaker_embedding_model = None

    def convert_m4a_to_wav(self, m4a_path: str) -> str:
        wav_path = tempfile.mktemp(suffix=".wav")
        try:
            audio = AudioSegment.from_file(m4a_path, format="m4a")
            audio = audio.set_channels(1)
            audio = audio.set_frame_rate(16000)
            audio.export(wav_path, format="wav")
            return wav_path
        except Exception as e:
            print(f"Error converting m4a to wav: {e}")
            raise

    def _apply_vad(self, audio: np.ndarray, sample_rate: int = 16000) -> List[Dict[str, float]]:
        try:
            if self.speaker_embedding_model is not None:
                try:
                    from pyannote.audio import Pipeline
                    vad_pipeline = Pipeline.from_pretrained(
                        "pyannote/voice-activity-detection",
                        use_auth_token=settings.PYANNOTE_AUTH_TOKEN
                    )
                    import torchaudio
                    waveform, sr = torchaudio.load(audio if isinstance(audio, str) else None)
                    if sr != 16000:
                        resampler = torchaudio.transforms.Resample(sr, 16000)
                        waveform = resampler(waveform)
                    
                    vad_result = vad_pipeline({"waveform": waveform, "sample_rate": 16000})
                    segments = []
                    for speech in vad_result.get_timeline().support():
                        start = speech.start
                        end = speech.end
                        if end - start >= settings.VAD_MIN_SPEECH_DURATION:
                            segments.append({"start": start, "end": end})
                    return segments
                except Exception as e:
                    print(f"Pyannote VAD failed, using energy-based VAD: {e}")
        except:
            pass

        return self._energy_based_vad(audio, sample_rate)

    def _energy_based_vad(
        self,
        audio: np.ndarray,
        sample_rate: int = 16000,
        frame_length: int = 512,
        hop_length: int = 256,
        energy_threshold: float = 0.02,
        min_speech_duration: float = 0.3,
        min_silence_duration: float = 0.5
    ) -> List[Dict[str, float]]:
        if isinstance(audio, str):
            import librosa
            audio, sample_rate = librosa.load(audio, sr=sample_rate, mono=True)

        audio = audio.astype(np.float32)
        if audio.max() > 1.0:
            audio = audio / 32768.0

        frames = []
        for i in range(0, len(audio) - frame_length, hop_length):
            frame = audio[i:i + frame_length]
            energy = np.mean(frame ** 2)
            frames.append(energy)

        frames = np.array(frames)
        if len(frames) == 0:
            return [{"start": 0, "end": len(audio) / sample_rate}]

        adaptive_threshold = max(energy_threshold, np.mean(frames) * 0.5)
        is_speech = frames > adaptive_threshold

        speech_segments = []
        in_speech = False
        speech_start = 0

        for i, speech in enumerate(is_speech):
            time = i * hop_length / sample_rate
            if speech and not in_speech:
                speech_start = time
                in_speech = True
            elif not speech and in_speech:
                duration = time - speech_start
                if duration >= min_speech_duration:
                    speech_segments.append({"start": speech_start, "end": time})
                in_speech = False

        if in_speech:
            duration = (len(frames) * hop_length / sample_rate) - speech_start
            if duration >= min_speech_duration:
                speech_segments.append({"start": speech_start, "end": len(audio) / sample_rate})

        merged_segments = []
        for seg in speech_segments:
            if merged_segments and seg["start"] - merged_segments[-1]["end"] < min_silence_duration:
                merged_segments[-1]["end"] = seg["end"]
            else:
                merged_segments.append(seg)

        if not merged_segments:
            merged_segments = [{"start": 0, "end": len(audio) / sample_rate}]

        return merged_segments

    def transcribe_with_faster_whisper(
        self,
        audio_path: str,
        vad_segments: Optional[List[Dict[str, float]]] = None
    ) -> Tuple[str, List[Dict[str, Any]]]:
        if self.whisper_model is None:
            raise RuntimeError("Faster-Whisper model not loaded")

        segments, info = self.whisper_model.transcribe(
            audio_path,
            language="zh",
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=300
            ),
            beam_size=5,
            best_of=5,
            temperature=0.0,
            word_timestamps=True,
            condition_on_previous_text=True
        )

        full_text = ""
        word_segments = []

        for segment in segments:
            full_text += segment.text + " "
            if segment.words:
                for word in segment.words:
                    word_segments.append({
                        "start": float(word.start),
                        "end": float(word.end),
                        "word": word.word.strip(),
                        "probability": float(word.probability)
                    })
            else:
                word_segments.append({
                    "start": float(segment.start),
                    "end": float(segment.end),
                    "word": segment.text.strip(),
                    "probability": float(getattr(segment, 'avg_logprob', -1.0))
                })

        merged_segments = self._merge_words_to_segments(word_segments)

        return full_text.strip(), merged_segments

    def _merge_words_to_segments(
        self,
        word_segments: List[Dict[str, Any]],
        max_gap: float = 0.5,
        max_segment_duration: float = 30.0
    ) -> List[Dict[str, Any]]:
        if not word_segments:
            return []

        segments = []
        current_segment = {
            "start": word_segments[0]["start"],
            "end": word_segments[0]["end"],
            "text": word_segments[0]["word"],
            "words": [word_segments[0]]
        }

        for word in word_segments[1:]:
            gap = word["start"] - current_segment["end"]
            seg_duration = word["end"] - current_segment["start"]

            if gap < max_gap and seg_duration < max_segment_duration:
                current_segment["end"] = word["end"]
                current_segment["text"] += " " + word["word"]
                current_segment["words"].append(word)
            else:
                current_segment["text"] = current_segment["text"].strip()
                segments.append(current_segment)
                current_segment = {
                    "start": word["start"],
                    "end": word["end"],
                    "text": word["word"],
                    "words": [word]
                }

        if current_segment["text"].strip():
            current_segment["text"] = current_segment["text"].strip()
            segments.append(current_segment)

        return segments

    def _extract_speaker_embedding(
        self,
        audio_path: str,
        start: float,
        end: float
    ) -> Optional[np.ndarray]:
        if self.speaker_embedding_model is None:
            return None

        try:
            from pyannote.core import Segment
            segment = Segment(start, end)
            embedding = self.speaker_embedding_model.crop(audio_path, segment)
            return embedding.reshape(-1)
        except Exception as e:
            print(f"Error extracting speaker embedding: {e}")
            return None

    def _extract_fallback_embedding(
        self,
        audio: np.ndarray,
        sample_rate: int,
        start: float,
        end: float
    ) -> np.ndarray:
        try:
            start_sample = int(start * sample_rate)
            end_sample = int(end * sample_rate)
            if end_sample > len(audio):
                end_sample = len(audio)
            if start_sample >= end_sample:
                return np.zeros(60)

            segment_audio = audio[start_sample:end_sample]
            if len(segment_audio) < sample_rate * 0.1:
                return np.zeros(60)

            mfcc = librosa.feature.mfcc(y=segment_audio, sr=sample_rate, n_mfcc=20)
            mfcc_mean = np.mean(mfcc, axis=1)
            mfcc_std = np.std(mfcc, axis=1)
            mfcc_delta = librosa.feature.delta(mfcc)
            mfcc_delta_mean = np.mean(mfcc_delta, axis=1)
            mfcc_delta2 = librosa.feature.delta(mfcc, order=2)
            mfcc_delta2_mean = np.mean(mfcc_delta2, axis=1)

            feature = np.concatenate([
                mfcc_mean, mfcc_std,
                mfcc_delta_mean, mfcc_delta2_mean
            ])
            return feature
        except Exception as e:
            print(f"Error extracting fallback embedding: {e}")
            return np.zeros(60)

    def cluster_speakers(
        self,
        audio_path: str,
        segments: List[Dict[str, Any]],
        num_speakers: int = None
    ) -> List[Dict[str, Any]]:
        if num_speakers is None:
            num_speakers = settings.DEFAULT_SPEAKERS

        import librosa
        audio, sr = librosa.load(audio_path, sr=16000, mono=True)

        embeddings = []
        valid_indices = []

        for i, seg in enumerate(segments):
            if self.speaker_embedding_model is not None:
                embedding = self._extract_speaker_embedding(
                    audio_path, seg["start"], seg["end"]
                )
                if embedding is not None:
                    embeddings.append(embedding)
                    valid_indices.append(i)
                else:
                    embeddings.append(self._extract_fallback_embedding(
                        audio, sr, seg["start"], seg["end"]
                    ))
                    valid_indices.append(i)
            else:
                embeddings.append(self._extract_fallback_embedding(
                    audio, sr, seg["start"], seg["end"]
                ))
                valid_indices.append(i)

        if len(embeddings) <= 1:
            for seg in segments:
                seg["speaker"] = "Speaker 1"
            return segments

        from sklearn.cluster import AgglomerativeClustering
        from sklearn.preprocessing import StandardScaler

        features_array = np.array(embeddings)

        scaler = StandardScaler()
        features_scaled = scaler.fit_transform(features_array)

        n_clusters = min(num_speakers, len(features_array))
        if n_clusters < 2:
            n_clusters = 2

        try:
            clustering = AgglomerativeClustering(n_clusters=n_clusters)
            labels = clustering.fit_predict(features_scaled)
        except Exception as e:
            print(f"Clustering failed: {e}")
            labels = np.zeros(len(features_array), dtype=int)

        speaker_counts = {}
        for label in labels:
            speaker_counts[label] = speaker_counts.get(label, 0) + 1

        speaker_mapping = {}
        sorted_speakers = sorted(speaker_counts.items(), key=lambda x: x[1], reverse=True)
        for i, (label, _) in enumerate(sorted_speakers):
            speaker_mapping[label] = f"Speaker {i + 1}"

        for i, seg in enumerate(segments):
            if i < len(labels):
                seg["speaker"] = speaker_mapping.get(labels[i], "Speaker 1")
            else:
                seg["speaker"] = "Speaker 1"

        segments = self._smooth_speaker_labels(segments)

        return segments

    def _smooth_speaker_labels(
        self,
        segments: List[Dict[str, Any]],
        window_size: int = 3
    ) -> List[Dict[str, Any]]:
        if len(segments) < window_size:
            return segments

        speakers = [seg["speaker"] for seg in segments]

        for i in range(len(speakers)):
            start = max(0, i - window_size // 2)
            end = min(len(speakers), i + window_size // 2 + 1)
            window = speakers[start:end]
            most_common = max(set(window), key=window.count)
            segments[i]["speaker"] = most_common

        return segments

    def process_audio(
        self,
        m4a_path: str,
        num_speakers: int = None
    ) -> Dict[str, Any]:
        wav_path = self.convert_m4a_to_wav(m4a_path)

        try:
            print("Applying VAD...")
            vad_segments = self._apply_vad(wav_path)
            print(f"Found {len(vad_segments)} speech segments")

            print("Transcribing with Faster-Whisper...")
            full_text, segments = self.transcribe_with_faster_whisper(wav_path, vad_segments)
            print(f"Transcribed {len(segments)} segments")

            print("Clustering speakers...")
            segments_with_speakers = self.cluster_speakers(wav_path, segments, num_speakers)

            transcription_with_speakers = ""
            for seg in segments_with_speakers:
                transcription_with_speakers += f"[{seg['speaker']}] {seg['text']}\n"

            audio = AudioSegment.from_file(wav_path)
            duration = len(audio) // 1000

            return {
                "full_text": full_text,
                "transcription_with_speakers": transcription_with_speakers,
                "segments": segments_with_speakers,
                "duration": duration,
                "vad_segments": vad_segments
            }
        finally:
            if os.path.exists(wav_path):
                os.unlink(wav_path)


audio_processor = AudioProcessor()
