import { PacketRecord, BaselineProfile, DecodingResult } from '../types';

export interface ExtractedBits {
  bits: number[];
  source: 'reorder' | 'jitter' | 'combined';
  confidence: number;
  bitCount: number;
}

export interface DecodingAttempt {
  timestamp: number;
  result: DecodingResult;
  packetCount: number;
  suspicionScore: number;
}

export const MANCHESTER_PREAMBLE = [0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0];
export const SYNC_WORD = [1, 0, 1, 0, 1, 1, 0, 0];

export function extractBitsFromReorder(
  records: PacketRecord[],
  baseline: BaselineProfile,
  windowSize: number = 2
): ExtractedBits {
  if (records.length < windowSize * 4) {
    return { bits: [], source: 'reorder', confidence: 0, bitCount: 0 };
  }

  const bits: number[] = [];
  let reliableCount = 0;

  const baselineRate = Math.max(0.01, baseline.baselineReorderRate || 0.02);

  for (let i = 0; i < records.length - windowSize; i += windowSize) {
    const window = records.slice(i, i + windowSize);
    let reorderInWindow = 0;

    let maxSeq = -1;
    for (const pkt of window) {
      if (pkt.seq < maxSeq) {
        reorderInWindow++;
      } else {
        maxSeq = pkt.seq;
      }
    }

    const windowReorderRate = reorderInWindow / windowSize;
    const threshold = baselineRate * 1.5;

    if (windowReorderRate > threshold && reorderInWindow > 0) {
      bits.push(1);
      reliableCount++;
    } else if (windowReorderRate <= threshold) {
      bits.push(0);
      reliableCount++;
    }
  }

  const confidence = bits.length > 0 ? reliableCount / bits.length : 0;

  return {
    bits,
    source: 'reorder',
    confidence,
    bitCount: bits.length
  };
}

export function extractBitsFromJitter(
  records: PacketRecord[],
  baseline: BaselineProfile,
  windowSize: number = 2
): ExtractedBits {
  if (records.length < windowSize * 4) {
    return { bits: [], source: 'jitter', confidence: 0, bitCount: 0 };
  }

  const bits: number[] = [];
  let reliableCount = 0;

  const baselineJitter = baseline.baselineJitter || 10;
  const baselineStdDev = baseline.baselineJitterStdDev || baselineJitter * 0.5;
  const threshold = baselineJitter + baselineStdDev * 2;

  for (let i = 0; i < records.length - windowSize; i += windowSize) {
    const window = records.slice(i, i + windowSize);
    const avgLatency = window.reduce((sum, p) => sum + p.latency, 0) / windowSize;

    if (avgLatency > threshold) {
      bits.push(1);
      reliableCount++;
    } else {
      bits.push(0);
      reliableCount++;
    }
  }

  const confidence = bits.length > 0 ? reliableCount / bits.length : 0;

  return {
    bits,
    source: 'jitter',
    confidence,
    bitCount: bits.length
  };
}

export function combineBits(reorderBits: ExtractedBits, jitterBits: ExtractedBits): ExtractedBits {
  const minLen = Math.min(reorderBits.bits.length, jitterBits.bits.length);
  const bits: number[] = [];

  for (let i = 0; i < minLen; i++) {
    if (reorderBits.confidence >= jitterBits.confidence) {
      bits.push(reorderBits.bits[i]);
    } else {
      bits.push(jitterBits.bits[i]);
    }
  }

  const confidence = Math.max(reorderBits.confidence, jitterBits.confidence);

  return {
    bits,
    source: 'combined',
    confidence,
    bitCount: bits.length
  };
}

export function decodeManchester(bits: number[]): { data: number[]; startIndex: number; confidence: number } {
  if (bits.length < 32) {
    return { data: [], startIndex: -1, confidence: 0 };
  }

  let bestStart = -1;
  let bestMatch = 0;

  for (let start = 0; start < Math.min(bits.length - 32, 64); start++) {
    let matchCount = 0;
    const searchLen = Math.min(MANCHESTER_PREAMBLE.length, bits.length - start);

    for (let i = 0; i < searchLen; i++) {
      if (bits[start + i] === MANCHESTER_PREAMBLE[i]) {
        matchCount++;
      }
    }

    const matchRatio = matchCount / searchLen;
    if (matchRatio > bestMatch && matchRatio >= 0.6) {
      bestMatch = matchRatio;
      bestStart = start;
    }
  }

  if (bestStart === -1) {
    return { data: [], startIndex: -1, confidence: 0 };
  }

  const data: number[] = [];
  const dataStart = bestStart + MANCHESTER_PREAMBLE.length;

  for (let i = dataStart; i < bits.length - 1; i += 2) {
    const first = bits[i];
    const second = bits[i + 1];

    if (first === 0 && second === 1) {
      data.push(0);
    } else if (first === 1 && second === 0) {
      data.push(1);
    }
  }

  return {
    data,
    startIndex: bestStart,
    confidence: bestMatch
  };
}

export function findSyncWord(bits: number[], syncWord: number[] = SYNC_WORD): number {
  if (bits.length < syncWord.length) return -1;

  for (let i = 0; i <= bits.length - syncWord.length; i++) {
    let match = true;
    for (let j = 0; j < syncWord.length; j++) {
      if (bits[i + j] !== syncWord[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

export function bitsToBytes(bits: number[]): Uint8Array {
  const bytes: number[] = [];

  for (let i = 0; i < bits.length; i += 8) {
    if (i + 8 <= bits.length) {
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        byte = (byte << 1) | bits[i + j];
      }
      bytes.push(byte);
    }
  }

  return new Uint8Array(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

export function bytesToText(bytes: Uint8Array): string {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const text = decoder.decode(bytes);

    let printableCount = 0;
    for (const char of text) {
      const code = char.charCodeAt(0);
      if ((code >= 32 && code <= 126) || code === 10 || code === 13 || code === 9) {
        printableCount++;
      }
    }

    if (text.length > 0 && printableCount / text.length < 0.7) {
      return `[二进制数据，${bytes.length} 字节]`;
    }

    return text;
  } catch {
    return `[二进制数据，${bytes.length} 字节]`;
  }
}

export function attemptDecoding(
  records: PacketRecord[],
  baseline: BaselineProfile,
  suspicionScore: number
): DecodingResult {
  if (records.length < 50) {
    return {
      success: false,
      rawBits: '',
      bytes: [],
      hex: '',
      text: '',
      confidence: 0,
      method: 'insufficient_data',
      details: '需要至少 50 个数据包进行解码',
      bitCount: 0,
      byteCount: 0,
      encodingType: 'unknown'
    };
  }

  if (suspicionScore < 0.5) {
    return {
      success: false,
      rawBits: '',
      bytes: [],
      hex: '',
      text: '',
      confidence: 0,
      method: 'low_suspicion',
      details: '可疑度不足，跳过解码尝试',
      bitCount: 0,
      byteCount: 0,
      encodingType: 'unknown'
    };
  }

  const reorderBits = extractBitsFromReorder(records, baseline);
  const jitterBits = extractBitsFromJitter(records, baseline);
  const combinedBits = combineBits(reorderBits, jitterBits);

  let bestResult: DecodingResult | null = null;

  const extractionResults = [reorderBits, jitterBits, combinedBits];

  for (const extraction of extractionResults) {
    if (extraction.bits.length < 32) continue;

    const manchesterResult = decodeManchester(extraction.bits);

    if (manchesterResult.data.length >= 8) {
      const byteArray = bitsToBytes(manchesterResult.data);
      const bytesList = Array.from(byteArray);
      const hex = bytesToHex(byteArray);
      const text = bytesToText(byteArray);

      const result: DecodingResult = {
        success: true,
        rawBits: manchesterResult.data.join(''),
        bytes: bytesList,
        hex,
        text,
        confidence: manchesterResult.confidence * extraction.confidence,
        method: `manchester_${extraction.source}`,
        details: `从 ${extraction.source} 提取 ${extraction.bits.length} 比特，曼彻斯特解码到 ${manchesterResult.data.length} 比特`,
        bitCount: manchesterResult.data.length,
        byteCount: byteArray.length,
        encodingType: 'manchester'
      };

      if (!bestResult || result.confidence > bestResult.confidence) {
        bestResult = result;
      }
    }

    const syncIndex = findSyncWord(extraction.bits);
    if (syncIndex >= 0 && syncIndex + 32 < extraction.bits.length) {
      const rawData = extraction.bits.slice(syncIndex + SYNC_WORD.length);
      const byteArray = bitsToBytes(rawData);
      const bytesList = Array.from(byteArray);
      const hex = bytesToHex(byteArray);
      const text = bytesToText(byteArray);

      const result: DecodingResult = {
        success: true,
        rawBits: rawData.join(''),
        bytes: bytesList,
        hex,
        text,
        confidence: extraction.confidence * 0.7,
        method: `raw_syncword_${extraction.source}`,
        details: `从 ${extraction.source} 提取，找到同步字在位置 ${syncIndex}`,
        bitCount: rawData.length,
        byteCount: byteArray.length,
        encodingType: 'raw'
      };

      if (!bestResult || result.confidence > bestResult.confidence) {
        bestResult = result;
      }
    }
  }

  if (!bestResult) {
    const combinedLen = combinedBits.bits.length;
    return {
      success: false,
      rawBits: combinedBits.bits.slice(0, 128).join(''),
      bytes: [],
      hex: '',
      text: '',
      confidence: combinedBits.confidence,
      method: 'failed',
      details: `提取了 ${combinedLen} 比特，但未识别到有效编码`,
      bitCount: combinedLen,
      byteCount: 0,
      encodingType: 'unknown'
    };
  }

  return bestResult;
}

export function exportToHex(decodingResult: DecodingResult): string {
  return `WebRTC 隐蔽信道数据提取报告
====================================
时间: ${new Date().toLocaleString()}
方法: ${decodingResult.method}
可信度: ${(decodingResult.confidence * 100).toFixed(1)}%
比特数: ${decodingResult.bitCount}
字节数: ${decodingResult.byteCount}
编码类型: ${decodingResult.encodingType}
====================================

十六进制数据:
${decodingResult.hex}

文本数据:
${decodingResult.text || '[无]'}

原始比特流:
${decodingResult.rawBits}
`;
}

export function exportToText(decodingResult: DecodingResult): string {
  return decodingResult.text || '';
}
