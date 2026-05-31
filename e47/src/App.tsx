import { useEffect, useRef, useCallback } from 'react';
import { useCamera } from './hooks/useCamera';
import { useSegmentation } from './hooks/useSegmentation';
import { useWebGLRenderer } from './hooks/useWebGLRenderer';
import { useAppStore } from './store/useAppStore';
import { ControlPanel } from './components/ControlPanel';
import { getImageData } from './utils/image';
import {
  findConnectedComponents,
  createPersonInstances,
  trackInstances,
  findInstanceAtPoint,
  resetTrackIdCounter,
  buildCombinedMask,
} from './utils/instanceSegmentation';
import type { PersonInstance } from './types';
import { Loader2, AlertCircle, Users } from 'lucide-react';

const OUTPUT_WIDTH = 640;
const OUTPUT_HEIGHT = 480;
const INPUT_WIDTH = 192;
const INPUT_HEIGHT = 192;

function App() {
  const {
    postProcess,
    background,
    isModelLoaded,
    setModelLoaded,
    isProcessing,
    setProcessing,
    fps,
    setFps,
    error,
    setError,
    setUpdateBackgroundTexture,
    multiPersonEnabled,
    personInstances,
    setPersonInstances,
    showInstanceBorders,
    showInstanceColors,
    toggleInstanceSelection,
  } = useAppStore();

  const { videoRef, isCameraActive, toggleCamera, startCamera } = useCamera({
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
  });

  const {
    canvasRef,
    updateInputTexture,
    updateAlphaTexture,
    updateBackgroundTexture,
    render,
    renderWithInstances,
  } = useWebGLRenderer(OUTPUT_WIDTH, OUTPUT_HEIGHT);

  const { result, processFrame, progress } = useSegmentation();

  const prevInstancesRef = useRef<PersonInstance[]>([]);

  const animationFrameRef = useRef<number>(0);
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());
  const lastProcessTimeRef = useRef(0);
  const isProcessingRef = useRef(false);
  const pendingFrameRef = useRef<ImageData | null>(null);
  const lastAlphaDataRef = useRef<Uint8ClampedArray | null>(null);

  useEffect(() => {
    setUpdateBackgroundTexture(updateBackgroundTexture);
  }, [setUpdateBackgroundTexture, updateBackgroundTexture]);

  const processFrameThrottled = useCallback(() => {
    const now = Date.now();
    if (isProcessingRef.current || now - lastProcessTimeRef.current < 66) {
      return;
    }

    if (!videoRef.current) return;

    lastProcessTimeRef.current = now;
    isProcessingRef.current = true;

    try {
      const imageData = getImageData(videoRef.current, {
        width: INPUT_WIDTH,
        height: INPUT_HEIGHT,
      });
      processFrame(imageData);
    } catch (e) {
      console.error('Frame processing error:', e);
    } finally {
      isProcessingRef.current = false;
    }
  }, [processFrame]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !multiPersonEnabled) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = OUTPUT_WIDTH / rect.width;
      const scaleY = OUTPUT_HEIGHT / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const instance = findInstanceAtPoint(personInstances, x, y);
      if (instance) {
        toggleInstanceSelection(instance.trackId);
      }
    },
    [canvasRef, multiPersonEnabled, personInstances, toggleInstanceSelection]
  );

  const renderLoop = useCallback(() => {
    if (videoRef.current && isCameraActive) {
      updateInputTexture(videoRef.current);

      if (isModelLoaded) {
        processFrameThrottled();
      }

      if (result?.alphaData && result.alphaData !== lastAlphaDataRef.current) {
        if (lastAlphaDataRef.current) {
          lastAlphaDataRef.current = null;
        }
        updateAlphaTexture(result.alphaData);
        lastAlphaDataRef.current = result.alphaData;

        if (multiPersonEnabled) {
          const components = findConnectedComponents(result.alphaData, OUTPUT_WIDTH, OUTPUT_HEIGHT);
          const newInstances = createPersonInstances(components, result.alphaData, {
            width: OUTPUT_WIDTH,
            height: OUTPUT_HEIGHT,
          });
          const trackedInstances = trackInstances(prevInstancesRef.current, newInstances);
          prevInstancesRef.current = trackedInstances;
          setPersonInstances(trackedInstances);
        }
      }

      if (multiPersonEnabled && personInstances.length > 0) {
        renderWithInstances(postProcess, background, personInstances, showInstanceBorders, showInstanceColors);
      } else {
        render(postProcess, background);
      }

      frameCountRef.current++;
      const now = Date.now();
      if (now - lastFpsUpdateRef.current >= 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = now;
      }
    }

    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, [
    isCameraActive,
    isModelLoaded,
    processFrameThrottled,
    updateInputTexture,
    updateAlphaTexture,
    render,
    renderWithInstances,
    postProcess,
    background,
    result,
    setFps,
    multiPersonEnabled,
    personInstances,
    setPersonInstances,
    showInstanceBorders,
    showInstanceColors,
  ]);

  useEffect(() => {
    setModelLoaded(false);
  }, []);

  useEffect(() => {
    if (isModelLoaded) {
      animationFrameRef.current = requestAnimationFrame(renderLoop);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isModelLoaded, renderLoop]);

  useEffect(() => {
    if (!isCameraActive && canvasRef.current) {
      const gl = canvasRef.current.getContext('webgl2');
      if (gl) {
        gl.clearColor(0.1, 0.1, 0.1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
  }, [isCameraActive]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = 0;
      }

      lastAlphaDataRef.current = null;
      isProcessingRef.current = false;
      pendingFrameRef.current = null;
    };
  }, []);

  return (
    <div className="flex h-screen bg-gray-950">
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={OUTPUT_WIDTH}
            height={OUTPUT_HEIGHT}
            className="rounded-xl shadow-2xl border border-gray-700 cursor-crosshair"
            style={{ maxWidth: '100%', height: 'auto' }}
            onClick={handleCanvasClick}
          />
          
          {!isModelLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 rounded-xl">
              <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
              <p className="text-white text-lg">正在加载 AI 模型...</p>
              <div className="w-64 h-2 bg-gray-700 rounded-full mt-4 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <p className="text-gray-400 text-sm mt-2">
                {Math.round(progress * 100)}%
              </p>
            </div>
          )}

          {error && (
            <div className="absolute top-4 left-4 right-4 flex items-center gap-2 bg-red-500/90 text-white px-4 py-2 rounded-lg">
              <AlertCircle size={20} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {isModelLoaded && (
            <div className="absolute bottom-4 left-4 flex flex-wrap items-center gap-2">
              <div className="bg-black/60 text-white px-3 py-1 rounded-lg text-sm">
                FPS: {fps}
              </div>
              <div className="bg-black/60 text-white px-3 py-1 rounded-lg text-sm">
                {isProcessing ? '处理中...' : '就绪'}
              </div>
              {multiPersonEnabled && (
                <div className="bg-blue-500/80 text-white px-3 py-1 rounded-lg text-sm flex items-center gap-1">
                  <Users size={14} />
                  检测到 {personInstances.length} 人
                </div>
              )}
            </div>
          )}

          {multiPersonEnabled && isModelLoaded && personInstances.length > 0 && (
            <div className="absolute top-4 right-4 text-xs text-white/70 bg-black/50 px-3 py-2 rounded-lg">
              💡 点击画面中的人物可切换选中状态
            </div>
          )}
        </div>

        <video
          ref={videoRef}
          className="hidden"
          width={OUTPUT_WIDTH}
          height={OUTPUT_HEIGHT}
          playsInline
          muted
        />
      </div>

      <ControlPanel
        videoRef={videoRef}
        isCameraActive={isCameraActive}
        onToggleCamera={toggleCamera}
        onProcessFrame={processFrame}
        canvasRef={canvasRef}
      />
    </div>
  );
}

export default App;
