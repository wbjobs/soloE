import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { Participant, Subtitle } from './types';

export class MultiTrackService {
  private recordingsPath: string;

  constructor() {
    this.recordingsPath = path.join(__dirname, '../recordings');
  }

  async mergeMultiTrackAudio(
    participants: Participant[],
    outputPath: string
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const tempAudioFiles: string[] = [];

      try {
        for (const participant of participants) {
          if (participant.audioChunks.length > 0) {
            const tempPath = path.join(this.recordingsPath, `temp_audio_${participant.id}.webm`);
            const sortedChunks = participant.audioChunks
              .sort((a, b) => a.timestamp - b.timestamp)
              .map(c => c.data);
            const combinedBuffer = Buffer.concat(sortedChunks);
            fs.writeFileSync(tempPath, combinedBuffer);
            tempAudioFiles.push(tempPath);
          }
        }

        if (tempAudioFiles.length === 0) {
          throw new Error('No audio tracks to merge');
        }

        let command = ffmpeg();

        tempAudioFiles.forEach(file => {
          command = command.addInput(file);
        });

        const filterComplex = this.buildAudioMixFilter(tempAudioFiles.length);

        command
          .outputOptions([
            '-filter_complex', filterComplex,
            '-map', '[aout]',
            '-c:a', 'aac',
            '-b:a', '192k'
          ])
          .on('end', () => {
            tempAudioFiles.forEach(f => {
              try { fs.unlinkSync(f); } catch { }
            });
            resolve(outputPath);
          })
          .on('error', (err) => {
            tempAudioFiles.forEach(f => {
              try { fs.unlinkSync(f); } catch { }
            });
            reject(err);
          })
          .save(outputPath);
      } catch (error) {
        tempAudioFiles.forEach(f => {
          try { fs.unlinkSync(f); } catch { }
        });
        reject(error);
      }
    });
  }

  private buildAudioMixFilter(numTracks: number): string {
    const inputs = Array.from({ length: numTracks }, (_, i) => `[${i}:a]`).join('');
    return `${inputs}amix=inputs=${numTracks}:duration=longest[aout]`;
  }

  async createPictureInPictureVideo(
    participants: Participant[],
    outputPath: string
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      const tempVideoFiles: string[] = [];
      const participantData: { path: string; color: string; name: string }[] = [];

      try {
        for (const participant of participants) {
          if (participant.videoChunks.length > 0) {
            const tempPath = path.join(this.recordingsPath, `temp_video_${participant.id}.webm`);
            const sortedChunks = participant.videoChunks
              .sort((a, b) => a.timestamp - b.timestamp)
              .map(c => c.data);
            const combinedBuffer = Buffer.concat(sortedChunks);
            fs.writeFileSync(tempPath, combinedBuffer);
            tempVideoFiles.push(tempPath);
            participantData.push({
              path: tempPath,
              color: participant.color,
              name: participant.name
            });
          }
        }

        if (tempVideoFiles.length === 0) {
          throw new Error('No video tracks to merge');
        }

        if (tempVideoFiles.length === 1) {
          await this.convertToMp4(tempVideoFiles[0], outputPath);
          tempVideoFiles.forEach(f => {
            try { fs.unlinkSync(f); } catch { }
          });
          resolve(outputPath);
          return;
        }

        const filterComplex = this.buildPiPFilter(participantData);

        let command = ffmpeg();
        tempVideoFiles.forEach(file => {
          command = command.addInput(file);
        });

        command
          .outputOptions([
            '-filter_complex', filterComplex,
            '-map', '[vout]',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23'
          ])
          .on('end', () => {
            tempVideoFiles.forEach(f => {
              try { fs.unlinkSync(f); } catch { }
            });
            resolve(outputPath);
          })
          .on('error', (err) => {
            tempVideoFiles.forEach(f => {
              try { fs.unlinkSync(f); } catch { }
            });
            reject(err);
          })
          .save(outputPath);
      } catch (error) {
        tempVideoFiles.forEach(f => {
          try { fs.unlinkSync(f); } catch { }
        });
        reject(error);
      }
    });
  }

  private buildPiPFilter(participants: { path: string; color: string; name: string }[]): string {
    const numParticipants = participants.length;
    const mainWidth = 1280;
    const mainHeight = 720;

    if (numParticipants === 1) {
      return `[0:v]scale=${mainWidth}:${mainHeight}:force_original_aspect_ratio=decrease,pad=${mainWidth}:${mainHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1[vout]`;
    }

    const pipSize = numParticipants <= 3 ? 0.25 : 0.2;
    const pipWidth = Math.floor(mainWidth * pipSize);
    const pipHeight = Math.floor(mainHeight * pipSize);
    const padding = 20;

    let filters: string[] = [];

    for (let i = 0; i < numParticipants; i++) {
      filters.push(`[${i}:v]scale=${pipWidth}:${pipHeight}:force_original_aspect_ratio=decrease,pad=${pipWidth}:${pipHeight}:(ow-iw)/2:(oh-ih)/2,drawbox=x=0:y=0:w=${pipWidth}:h=${pipHeight}:color=${participants[i].color.replace('#', '')}@1:t=5[v${i}]`);
    }

    let overlay = `color=size=${mainWidth}x${mainHeight}:color=black[base]`;

    if (numParticipants >= 1) {
      overlay += `;[base][v0]overlay=x=${padding}:y=${padding}[l0]`;
    }
    if (numParticipants >= 2) {
      overlay += `;[l0][v1]overlay=x=${mainWidth - pipWidth - padding}:y=${padding}[l1]`;
    }
    if (numParticipants >= 3) {
      overlay += `;[l1][v2]overlay=x=${padding}:y=${mainHeight - pipHeight - padding}[l2]`;
    }
    if (numParticipants >= 4) {
      overlay += `;[l2][v3]overlay=x=${mainWidth - pipWidth - padding}:y=${mainHeight - pipHeight - padding}[vout]`;
    } else {
      overlay += `[l${numParticipants - 1}]`;
      if (numParticipants < 4) overlay = overlay.replace(`[l${numParticipants - 1}]`, '[vout]');
    }

    return filters.join(';') + ';' + overlay;
  }

  private async convertToMp4(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-strict', 'experimental'
        ])
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .save(outputPath);
    });
  }

  generateSpeakerSubtitlesSRT(subtitles: Subtitle[]): string {
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

      const speakerPrefix = sub.speakerName ? `[${sub.speakerName}] ` : '';
      srt += `${index + 1}\n`;
      srt += `${formatTime(sub.startTime)} --> ${formatTime(sub.endTime)}\n`;
      srt += `${speakerPrefix}${sub.text}\n\n`;
    });
    return srt;
  }

  async mergeAudioVideoWithSubtitles(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    subtitles?: Subtitle[]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let command = ffmpeg()
        .addInput(videoPath)
        .addInput(audioPath);

      command = command.outputOptions([
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-strict', 'experimental',
        '-async', '1',
        '-vsync', '1',
        '-fflags', '+genpts'
      ]);

      if (subtitles && subtitles.length > 0) {
        const srtPath = path.join(path.dirname(outputPath), `subs_${Date.now()}.srt`);
        const srtContent = this.generateSpeakerSubtitlesSRT(subtitles);
        fs.writeFileSync(srtPath, srtContent);

        command = command.outputOptions([
          '-vf', `subtitles=${srtPath.replace(/\\/g, '/')}:force_style='FontSize=18,PrimaryColour=&Hffffff,OutlineColour=&H0,BorderStyle=1,Outline=1'`
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
}
