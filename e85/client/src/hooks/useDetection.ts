import { useState, useCallback, useEffect, useRef } from 'react';
import { analyzePackets, buildBaseline } from '../utils/detection';
import { attemptDecoding, exportToHex, exportToText } from '../utils/decoding';
import { getSocket } from '../utils/socket';
import { PacketRecord, DetectionMetrics, DetectionReport, BaselineProfile, DecodingLog, DecodingResult } from '../types';

const emptyBaseline: BaselineProfile = {
  isEstablished: false,
  baselinePacketCount: 0,
  baselineAvgLatency: 0,
  baselineJitter: 0,
  baselineJitterStdDev: 0,
  baselineReorderRate: 0,
  baselineLatencyPercentile95: 0,
  createdAt: null
};

export function useDetection(
  sessionId: string,
  peerId: string,
  getPacketRecords: () => PacketRecord[]
) {
  const [metrics, setMetrics] = useState<DetectionMetrics | null>(null);
  const [reportHistory, setReportHistory] = useState<DetectionReport[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [baseline, setBaseline] = useState<BaselineProfile>(emptyBaseline);
  const [decodingResult, setDecodingResult] = useState<DecodingResult | null>(null);
  const [isDecoding, setIsDecoding] = useState(false);
  const [decodingHistory, setDecodingHistory] = useState<DecodingLog[]>([]);

  const analysisIntervalRef = useRef<number | null>(null);
  const socketRef = useRef(getSocket());
  const baselineLockedRef = useRef(false);

  const updateBaselineFromRecords = useCallback((records: PacketRecord[]) => {
    if (baselineLockedRef.current && baseline.isEstablished) {
      return baseline;
    }

    const newBaseline = buildBaseline(records);
    setBaseline(newBaseline);

    if (newBaseline.isEstablished && !baselineLockedRef.current) {
      baselineLockedRef.current = true;
      console.log('Baseline established with', newBaseline.baselinePacketCount, 'packets');
    }

    return newBaseline;
  }, [baseline.isEstablished]);

  const analyzeCurrent = useCallback(() => {
    const records = getPacketRecords();
    const currentBaseline = updateBaselineFromRecords(records);
    const result = analyzePackets(records, currentBaseline.isEstablished ? currentBaseline : undefined);
    setMetrics(result);
    return result;
  }, [getPacketRecords, updateBaselineFromRecords]);

  const sendReport = useCallback((metrics: DetectionMetrics) => {
    if (metrics.totalPackets < 10) return;

    const report: Omit<DetectionReport, 'id'> = {
      sessionId,
      peerId,
      timestamp: Date.now(),
      jitterScore: metrics.jitterScore,
      reorderScore: metrics.reorderScore,
      overallSuspicion: metrics.overallSuspicion,
      totalPackets: metrics.totalPackets,
      reorderedPackets: metrics.reorderedPackets,
      avgLatency: metrics.avgLatency,
      jitter: metrics.jitter,
      details: metrics.details
    };

    socketRef.current.emit('detection-report', report);
    setReportHistory((prev) => [...prev.slice(-49), { id: Date.now(), ...report }]);
  }, [sessionId, peerId]);

  const performDecoding = useCallback(() => {
    setIsDecoding(true);
    try {
      const records = getPacketRecords();
      const currentMetrics = metrics || analyzeCurrent();
      const result = attemptDecoding(records, baseline, currentMetrics.overallSuspicion);
      setDecodingResult(result);

      const log: Omit<DecodingLog, 'id'> = {
        sessionId,
        peerId,
        timestamp: Date.now(),
        suspicionScore: currentMetrics.overallSuspicion,
        decodingSuccess: result.success,
        decodingMethod: result.method,
        confidence: result.confidence,
        bitCount: result.bitCount,
        byteCount: result.byteCount,
        encodingType: result.encodingType,
        hexData: result.hex,
        textData: result.text,
        rawBits: result.rawBits.slice(0, 512),
        details: result.details || ''
      };

      socketRef.current.emit('decoding-log', log);
      setDecodingHistory((prev) => [...prev.slice(-19), { id: Date.now(), ...log }]);

      return result;
    } catch (err) {
      console.error('Decoding failed:', err);
      return null;
    } finally {
      setIsDecoding(false);
    }
  }, [getPacketRecords, baseline, metrics, analyzeCurrent, sessionId, peerId]);

  const exportHex = useCallback(() => {
    if (!decodingResult) return null;
    return exportToHex(decodingResult);
  }, [decodingResult]);

  const exportText = useCallback(() => {
    if (!decodingResult) return null;
    return exportToText(decodingResult);
  }, [decodingResult]);

  const downloadFile = useCallback((content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const startAutoAnalysis = useCallback((intervalMs: number = 5000) => {
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
    }
    setIsAnalyzing(true);
    analysisIntervalRef.current = window.setInterval(() => {
      const result = analyzeCurrent();
      sendReport(result);
    }, intervalMs);
  }, [analyzeCurrent, sendReport]);

  const stopAutoAnalysis = useCallback(() => {
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
      analysisIntervalRef.current = null;
    }
    setIsAnalyzing(false);
  }, []);

  const resetBaseline = useCallback(() => {
    baselineLockedRef.current = false;
    setBaseline(emptyBaseline);
    setDecodingResult(null);
    console.log('Baseline reset');
  }, []);

  const forceRebuildBaseline = useCallback(() => {
    baselineLockedRef.current = false;
    const records = getPacketRecords();
    const newBaseline = buildBaseline(records);
    setBaseline(newBaseline);
    if (newBaseline.isEstablished) {
      baselineLockedRef.current = true;
    }
    console.log('Baseline force rebuilt with', newBaseline.baselinePacketCount, 'packets');
  }, [getPacketRecords]);

  const fetchHistory = useCallback(async (suspiciousOnly: boolean = false) => {
    try {
      const url = suspiciousOnly
        ? '/api/reports?suspicious=true'
        : `/api/reports?sessionId=${encodeURIComponent(sessionId)}`;
      const response = await fetch(url);
      const data = await response.json();
      setReportHistory(data);
    } catch (e) {
      console.error('Failed to fetch history:', e);
    }
  }, [sessionId]);

  const fetchDecodingHistory = useCallback(async () => {
    try {
      const url = `/api/decoding-logs?sessionId=${encodeURIComponent(sessionId)}`;
      const response = await fetch(url);
      const data = await response.json();
      setDecodingHistory(data);
    } catch (e) {
      console.error('Failed to fetch decoding history:', e);
    }
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
    };
  }, []);

  return {
    metrics,
    reportHistory,
    isAnalyzing,
    baseline,
    decodingResult,
    isDecoding,
    decodingHistory,
    analyzeCurrent,
    startAutoAnalysis,
    stopAutoAnalysis,
    resetBaseline,
    forceRebuildBaseline,
    performDecoding,
    exportHex,
    exportText,
    downloadFile,
    fetchHistory,
    fetchDecodingHistory
  };
}
