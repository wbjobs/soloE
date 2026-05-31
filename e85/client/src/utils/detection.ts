import { PacketRecord, DetectionMetrics, BaselineProfile } from '../types';

export const BASELINE_PACKET_COUNT = 100;
export const BASELINE_WARMUP_COUNT = 20;

export function calculateJitter(latencies: number[]): number {
  if (latencies.length < 2) return 0;
  let jitterSum = 0;
  for (let i = 1; i < latencies.length; i++) {
    jitterSum += Math.abs(latencies[i] - latencies[i - 1]);
  }
  return jitterSum / (latencies.length - 1);
}

export function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function countReorderedPackets(records: PacketRecord[]): { count: number; gaps: number[] } {
  let reorderCount = 0;
  const gaps: number[] = [];
  let maxSeq = -1;

  for (let i = 0; i < records.length; i++) {
    const currentSeq = records[i].seq;
    if (currentSeq < maxSeq) {
      reorderCount++;
      gaps.push(maxSeq - currentSeq);
    } else {
      maxSeq = currentSeq;
    }
  }

  return { count: reorderCount, gaps };
}

export function calculateReorderEntropy(records: PacketRecord[]): number {
  if (records.length < 2) return 0;

  const transitions: { [key: string]: number } = {};
  let totalTransitions = 0;

  for (let i = 1; i < records.length; i++) {
    const prevSeq = records[i - 1].seq;
    const currSeq = records[i].seq;
    const diff = currSeq - prevSeq;
    const key = diff > 0 ? 'forward' : diff < 0 ? 'backward' : 'same';

    transitions[key] = (transitions[key] || 0) + 1;
    totalTransitions++;
  }

  if (totalTransitions === 0) return 0;

  let entropy = 0;
  for (const key of Object.keys(transitions)) {
    const p = transitions[key] / totalTransitions;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

export function detectBurstPatterns(records: PacketRecord[], windowSize: number = 10): number {
  if (records.length < windowSize * 2) return 0;

  const reorderRates: number[] = [];

  for (let i = 0; i <= records.length - windowSize; i++) {
    const window = records.slice(i, i + windowSize);
    const { count } = countReorderedPackets(window);
    reorderRates.push(count / windowSize);
  }

  const stdDev = calculateStdDev(reorderRates);
  const mean = reorderRates.reduce((a, b) => a + b, 0) / reorderRates.length;

  return mean > 0 ? stdDev / mean : 0;
}

export function buildBaseline(records: PacketRecord[]): BaselineProfile {
  const warmupRecords = records.slice(0, BASELINE_PACKET_COUNT);

  if (warmupRecords.length < BASELINE_WARMUP_COUNT) {
    return {
      isEstablished: false,
      baselinePacketCount: warmupRecords.length,
      baselineAvgLatency: 0,
      baselineJitter: 0,
      baselineJitterStdDev: 0,
      baselineReorderRate: 0,
      baselineLatencyPercentile95: 0,
      createdAt: null
    };
  }

  const latencies = warmupRecords.map((r) => r.latency);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const jitter = calculateJitter(latencies);
  const jitterStdDev = calculateStdDev(latencies);
  const { count: reorderCount } = countReorderedPackets(warmupRecords);
  const reorderRate = reorderCount / warmupRecords.length;
  const percentile95 = calculatePercentile(latencies, 95);

  const isEstablished = warmupRecords.length >= BASELINE_PACKET_COUNT * 0.8;

  return {
    isEstablished,
    baselinePacketCount: warmupRecords.length,
    baselineAvgLatency: avgLatency,
    baselineJitter: jitter,
    baselineJitterStdDev: jitterStdDev,
    baselineReorderRate: reorderRate,
    baselineLatencyPercentile95: percentile95,
    createdAt: isEstablished ? Date.now() : null
  };
}

export function detectAnomalyPatterns(
  records: PacketRecord[],
  baseline: BaselineProfile
): number {
  if (!baseline.isEstablished || records.length < 20) return 0;

  const recentRecords = records.slice(-100);
  const recentLatencies = recentRecords.map((r) => r.latency);

  let anomalyScore = 0;

  const recentJitter = calculateJitter(recentLatencies);
  const baselineJitterThreshold = baseline.baselineJitter + baseline.baselineJitterStdDev * 3;

  if (baseline.baselineJitter > 0) {
    const jitterRatio = recentJitter / baseline.baselineJitter;
    if (recentJitter > baselineJitterThreshold) {
      const excess = (recentJitter - baselineJitterThreshold) / baselineJitterThreshold;
      anomalyScore += Math.min(0.4, excess * 0.5);
    }
    if (jitterRatio > 5) {
      anomalyScore += 0.2;
    }
  }

  const { count: recentReorderCount } = countReorderedPackets(recentRecords);
  const recentReorderRate = recentReorderCount / recentRecords.length;
  const baselineReorderThreshold = Math.max(0.02, baseline.baselineReorderRate * 2);

  if (recentReorderRate > baselineReorderThreshold) {
    const excessRate = recentReorderRate - baseline.baselineReorderRate;
    anomalyScore += Math.min(0.5, excessRate * 10);

    if (recentReorderRate > 0.2 && baseline.baselineReorderRate < 0.05) {
      anomalyScore += 0.3;
    }
  }

  const recentAvgLatency = recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length;
  const latencyDeviation = Math.abs(recentAvgLatency - baseline.baselineAvgLatency);
  if (latencyDeviation > baseline.baselineLatencyPercentile95 * 1.5) {
    anomalyScore += 0.1;
  }

  const entropy = calculateReorderEntropy(recentRecords);
  if (recentReorderRate > 0.05) {
    const normalizedEntropy = entropy / Math.log2(3);
    if (normalizedEntropy < 0.3) {
      anomalyScore += 0.2;
    }
  }

  const burstScore = detectBurstPatterns(recentRecords);
  if (burstScore > 1.5) {
    anomalyScore += Math.min(0.2, (burstScore - 1.5) * 0.4);
  }

  return Math.min(1, anomalyScore);
}

export function scoreJitterSuspicionAdaptive(
  jitter: number,
  avgLatency: number,
  baseline: BaselineProfile | undefined
): number {
  if (avgLatency === 0) return 0;

  if (baseline && baseline.isEstablished && baseline.baselineJitter > 0) {
    const jitterRatioToBaseline = jitter / baseline.baselineJitter;

    if (jitterRatioToBaseline < 1.5) return 0;
    if (jitterRatioToBaseline < 2.5) return 0.15;
    if (jitterRatioToBaseline < 4) return 0.35;
    if (jitterRatioToBaseline < 6) return 0.6;
    return Math.min(1, (jitterRatioToBaseline - 6) * 0.2 + 0.6);
  }

  const jitterRatio = jitter / avgLatency;
  if (jitterRatio < 0.2) return 0;
  if (jitterRatio < 0.4) return 0.2;
  if (jitterRatio < 0.7) return 0.4;
  if (jitterRatio < 1.0) return 0.65;
  return Math.min(1, jitterRatio);
}

export function scoreReorderSuspicionAdaptive(
  reorderRate: number,
  reorderEntropy: number,
  burstScore: number,
  baseline: BaselineProfile | undefined
): number {
  if (baseline && baseline.isEstablished) {
    const baselineRate = Math.max(0.01, baseline.baselineReorderRate);
    const rateRatio = reorderRate / baselineRate;

    let rateScore = 0;
    if (rateRatio < 2) rateScore = 0;
    else if (rateRatio < 4) rateScore = 0.2;
    else if (rateRatio < 8) rateScore = 0.5;
    else rateScore = Math.min(1, (rateRatio - 8) * 0.1 + 0.5);

    if (reorderRate > 0.02 && baseline.baselineReorderRate < 0.01) {
      rateScore = Math.max(rateScore, 0.3);
    }

    const entropyScore = reorderEntropy / Math.log2(3);
    const burstScoreNormalized = Math.min(1, burstScore);

    return rateScore * 0.5 + entropyScore * 0.25 + burstScoreNormalized * 0.25;
  }

  const rateScore = Math.min(1, reorderRate * 5);
  const entropyScore = reorderEntropy / Math.log2(3);
  const burstScoreNormalized = Math.min(1, burstScore);

  return rateScore * 0.5 + entropyScore * 0.3 + burstScoreNormalized * 0.2;
}

export function analyzePackets(
  records: PacketRecord[],
  existingBaseline?: BaselineProfile
): DetectionMetrics {
  const totalPackets = records.length;

  if (totalPackets < 10) {
    return {
      jitterScore: 0,
      reorderScore: 0,
      overallSuspicion: 0,
      totalPackets,
      reorderedPackets: 0,
      avgLatency: 0,
      jitter: 0,
      reorderEntropy: 0,
      burstPatternScore: 0,
      anomalyPatternScore: 0,
      details: JSON.stringify({
        message: 'Insufficient data for analysis',
        packetCount: totalPackets
      })
    };
  }

  let baseline: BaselineProfile;
  if (existingBaseline && existingBaseline.isEstablished) {
    baseline = existingBaseline;
  } else {
    baseline = buildBaseline(records);
  }

  const latencies = records.map((r) => r.latency);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const jitter = calculateJitter(latencies);

  const { count: reorderedPackets } = countReorderedPackets(records);
  const reorderRate = reorderedPackets / totalPackets;
  const reorderEntropy = calculateReorderEntropy(records);
  const burstPatternScore = detectBurstPatterns(records);
  const anomalyPatternScore = detectAnomalyPatterns(records, baseline);

  const jitterScore = scoreJitterSuspicionAdaptive(jitter, avgLatency, baseline.isEstablished ? baseline : undefined);
  const reorderScore = scoreReorderSuspicionAdaptive(
    reorderRate,
    reorderEntropy,
    burstPatternScore,
    baseline.isEstablished ? baseline : undefined
  );

  let overallSuspicion: number;
  if (baseline.isEstablished) {
    overallSuspicion = jitterScore * 0.25 + reorderScore * 0.45 + anomalyPatternScore * 0.3;
  } else {
    overallSuspicion = jitterScore * 0.4 + reorderScore * 0.6;
    overallSuspicion *= Math.min(1, totalPackets / BASELINE_PACKET_COUNT);
  }

  const details = JSON.stringify({
    reorderRate: reorderRate.toFixed(4),
    jitterRatio: avgLatency > 0 ? (jitter / avgLatency).toFixed(4) : '0',
    reorderEntropy: reorderEntropy.toFixed(4),
    burstPatternScore: burstPatternScore.toFixed(4),
    anomalyPatternScore: anomalyPatternScore.toFixed(4),
    latencyStdDev: calculateStdDev(latencies).toFixed(2),
    baselineEstablished: baseline.isEstablished,
    baselinePacketCount: baseline.baselinePacketCount,
    baselineJitter: baseline.baselineJitter.toFixed(2),
    baselineReorderRate: baseline.baselineReorderRate.toFixed(4)
  });

  return {
    jitterScore,
    reorderScore,
    overallSuspicion,
    totalPackets,
    reorderedPackets,
    avgLatency,
    jitter,
    reorderEntropy,
    burstPatternScore,
    anomalyPatternScore,
    details,
    baseline
  };
}

export function getSuspicionLevel(score: number): { level: string; color: string } {
  if (score < 0.3) return { level: '正常', color: '#22c55e' };
  if (score < 0.5) return { level: '低风险', color: '#eab308' };
  if (score < 0.7) return { level: '中风险', color: '#f97316' };
  return { level: '高风险', color: '#ef4444' };
}

export function getBaselineStatus(baseline: BaselineProfile | undefined): { status: string; color: string; progress: number } {
  if (!baseline) {
    return { status: '未初始化', color: '#64748b', progress: 0 };
  }

  const progress = Math.min(100, (baseline.baselinePacketCount / BASELINE_PACKET_COUNT) * 100);

  if (baseline.isEstablished) {
    return { status: '已建立', color: '#22c55e', progress: 100 };
  }

  if (baseline.baselinePacketCount === 0) {
    return { status: '等待数据...', color: '#64748b', progress: 0 };
  }

  if (baseline.baselinePacketCount < BASELINE_WARMUP_COUNT) {
    return { status: '预热中...', color: '#eab308', progress };
  }

  return { status: '学习中...', color: '#3b82f6', progress };
}
