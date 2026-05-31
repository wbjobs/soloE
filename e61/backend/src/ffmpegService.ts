import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { Subtitle, Bookmark } from './types';

export class FFmpegService {
  private recordingsPath: string;

  constructor() {
    this.recordingsPath = path.join(__dirname, '../recordings');
  }

  async mergeAudioVideo(
    audioPath: string,
    videoPath: string,
    outputPath: string,
    subtitles?: Subtitle[]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let command = ffmpeg();

      command = command.addInput(videoPath);
      command = command.addInput(audioPath);

      command = command.outputOptions([
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-strict', 'experimental',
        '-async', '1',
        '-vsync', '1',
        '-fflags', '+genpts'
      ]);

      if (subtitles && subtitles.length > 0) {
        const srtPath = path.join(path.dirname(outputPath), `${Date.now()}.srt`);
        const srtContent = this.generateSRT(subtitles);
        fs.writeFileSync(srtPath, srtContent);
        
        command = command.outputOptions([
          '-vf', `subtitles=${srtPath.replace(/\\/g, '/')}:force_style='FontSize=24,PrimaryColour=&Hffffff'`
        ]);
      }

      command
        .on('end', () => {
          resolve(outputPath);
        })
        .on('error', (err) => {
          reject(err);
        })
        .save(outputPath);
    });
  }

  async webmToMp4(webmPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(webmPath)
        .outputOptions('-c:v', 'libx264')
        .outputOptions('-c:a', 'aac')
        .outputOptions('-strict', 'experimental')
        .on('end', () => {
          resolve(outputPath);
        })
        .on('error', (err) => {
          reject(err);
        })
        .save(outputPath);
    });
  }

  async combineChunks(chunks: Buffer[], outputPath: string): Promise<void> {
    const combinedBuffer = Buffer.concat(chunks);
    fs.writeFileSync(outputPath, combinedBuffer);
  }

  private generateSRT(subtitles: Subtitle[]): string {
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

  generateChapterFile(bookmarks: Bookmark[], outputPath: string): void {
    let chapterContent = ';FFMETADATA1\n';
    bookmarks.forEach((bookmark, index) => {
      const startTime = Math.floor(bookmark.time * 1000);
      chapterContent += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${startTime}\nEND=${startTime + 1000}\ntitle=${bookmark.label}\n`;
    });
    fs.writeFileSync(outputPath, chapterContent);
  }
}
