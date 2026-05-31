import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { SegmentationResult, Dimensions } from '../types';

const WORKER_WIDTH = 192;
const WORKER_HEIGHT = 192;
const GC_INTERVAL = 30000;

export function useSegmentation() {
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SegmentationResult | null>(null);
  
  const isLoaded = useAppStore((state) => state.isModelLoaded);
  const isProcessing = useAppStore((state) => state.isProcessing);
  const error = useAppStore((state) => state.error);
  const setModelLoaded = useAppStore((state) => state.setModelLoaded);
  const setProcessing = useAppStore((state) => state.setProcessing);
  const setError = useAppStore((state) => state.setError);
  
  const workerRef = useRef<Worker | null>(null);
  const isProcessingRef = useRef(false);
  const pendingFrameRef = useRef<ImageData | null>(null);
  const frameCountRef = useRef(0);
  const lastGcTimeRef = useRef(Date.now());

  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/segmentation.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent) => {
      const { type, payload } = e.data;

      switch (type) {
        case 'loaded':
          setModelLoaded(true);
          setProgress(1);
          break;
        case 'progress':
          setProgress(payload);
          break;
        case 'result':
          const alphaData = new Uint8ClampedArray(payload.alphaData);
          
          setResult(prev => {
            if (prev) {
              (prev.alphaData as any) = null;
            }
            return {
              alphaData,
              dimensions: payload.dimensions,
              inferenceTime: payload.inferenceTime,
            };
          });
          
          isProcessingRef.current = false;
          setProcessing(false);
          frameCountRef.current++;
          
          if (Date.now() - lastGcTimeRef.current > GC_INTERVAL) {
            if ('gc' in window) {
              try {
                (window as any).gc();
              } catch (e) {}
            }
            lastGcTimeRef.current = Date.now();
          }
          
          if (pendingFrameRef.current) {
            processFrame(pendingFrameRef.current);
            pendingFrameRef.current = null;
          }
          break;
        case 'error':
          setError(payload);
          isProcessingRef.current = false;
          setProcessing(false);
          break;
      }
    };

    workerRef.current = worker;
    worker.postMessage({ type: 'load' });

    return () => {
      worker.terminate();
      workerRef.current = null;
      pendingFrameRef.current = null;
      isProcessingRef.current = false;
    };
  }, [setModelLoaded, setProcessing, setError]);

  const processFrame = useCallback((imageData: ImageData, targetDimensions?: Dimensions) => {
    if (!workerRef.current || !isLoaded) return;
    if (isProcessingRef.current) {
      pendingFrameRef.current = imageData;
      return;
    }

    isProcessingRef.current = true;
    setProcessing(true);

    const targetWidth = targetDimensions?.width || 640;
    const targetHeight = targetDimensions?.height || 480;

    workerRef.current.postMessage({
      type: 'segment',
      payload: {
        imageData: imageData.data.buffer,
        originalWidth: targetWidth,
        originalHeight: targetHeight,
      },
    }, [imageData.data.buffer]);
  }, [isLoaded, setProcessing]);

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'cancel' });
    }
    pendingFrameRef.current = null;
    isProcessingRef.current = false;
    setProcessing(false);
  }, [setProcessing]);

  return {
    isLoaded,
    isProcessing,
    progress,
    error,
    result,
    processFrame,
    cancel,
  };
}
