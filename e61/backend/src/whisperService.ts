import fs from 'fs';
import path from 'path';
import { Subtitle } from './types';

export class WhisperService {
  private modelPath: string;

  constructor() {
    this.modelPath = path.join(__dirname, '../models/ggml-base.bin');
  }

  async transcribeAudio(audioBuffer: Buffer, startTime: number): Promise<Subtitle[]> {
    try {
      const tempAudioPath = path.join(__dirname, '../uploads', `temp_${Date.now()}.wav`);
      fs.writeFileSync(tempAudioPath, audioBuffer);

      const subtitles: Subtitle[] = [];
      
      const mockTranscriptions = [
        { start: 0, end: 3, text: "正在录制..." },
        { start: 3, end: 6, text: "语音识别进行中" },
        { start: 6, end: 10, text: "这是实时字幕示例" }
      ];

      mockTranscriptions.forEach(item => {
        subtitles.push({
          startTime: startTime + item.start,
          endTime: startTime + item.end,
          text: item.text
        });
      });

      fs.unlinkSync(tempAudioPath);
      return subtitles;
    } catch (error) {
      console.error('Whisper transcription error:', error);
      return [];
    }
  }

  generateSRT(subtitles: Subtitle[]): string {
    let srt = '';
    subtitles.forEach((sub, index) => {
      const formatTime = (seconds: number) => {
        const date = new Date(seconds * 1000);
        const h = date.getUTCHours().toString().padStart(2, '0');
        const m = date.getUTCMinutes().toString().padStart(2, '0');
        const s = date.getUTCSeconds().toString().padStart(2, '0');
        const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
        return `${h}:${m}:${s},${ms}`;
      };

      srt += `${index + 1}\n`;
      srt += `${formatTime(sub.startTime)} --> ${formatTime(sub.endTime)}\n`;
      srt += `${sub.text}\n\n`;
    });
    return srt;
  }
}
