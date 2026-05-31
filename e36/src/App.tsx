import { useState, useEffect, useRef, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as bodySegmentation from '@tensorflow-models/body-segmentation';
import init, { applyGrayscale, applyVintage, applySobelEdge } from '../pkg/video_filters';

type FilterType = 'none' | 'grayscale' | 'vintage' | 'sobel' | 'portrait';

interface DoubleBuffer {
  front: ImageData;
  back: ImageData;
}

const App = () => {
  const [wasmLoaded, setWasmLoaded] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('grayscale');
  const [intensity, setIntensity] = useState(1);
  const [fps, setFps] = useState(0);
  const [processingTime, setProcessingTime] = useState(0);
  
  const [portraitEnabled, setPortraitEnabled] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [blurIntensity, setBlurIntensity] = useState(15);

  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const filteredCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const animationRef = useRef<number | null>(null);
  const doubleBufferRef = useRef<DoubleBuffer | null>(null);
  const isProcessingRef = useRef(false);
  const segmenterRef = useRef<bodySegmentation.BodySegmenter | null>(null);
  const segmentationMaskRef = useRef<Uint8ClampedArray | null>(null);
  const segmentationFrameRef = useRef(0);
  const filterStateRef = useRef({
    currentFilter: 'grayscale' as FilterType,
    intensity: 1,
    portraitEnabled: false,
    blurIntensity: 15
  });

  const WIDTH = 1920;
  const HEIGHT = 1080;
  const SEGMENTATION_SKIP = 3;

  useEffect(() => {
    const loadWasm = async () => {
      await init();
      setWasmLoaded(true);
    };
    loadWasm();
  }, []);

  useEffect(() => {
    filterStateRef.current.currentFilter = currentFilter;
  }, [currentFilter]);

  useEffect(() => {
    filterStateRef.current.intensity = intensity;
  }, [intensity]);

  useEffect(() => {
    filterStateRef.current.portraitEnabled = portraitEnabled;
  }, [portraitEnabled]);

  useEffect(() => {
    filterStateRef.current.blurIntensity = blurIntensity;
  }, [blurIntensity]);

  const loadSegmentationModel = async () => {
    if (modelLoaded || modelLoading) return;
    
    setModelLoading(true);
    try {
      await tf.setBackend('webgl');
      await tf.ready();
      
      const model = bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation;
      const segmenterConfig: bodySegmentation.MediaPipeSelfieSegmentationModelConfig = {
        runtime: 'tfjs',
        modelType: 'general'
      };
      
      segmenterRef.current = await bodySegmentation.createSegmenter(model, segmenterConfig);
      setModelLoaded(true);
    } catch (error) {
      console.error('Failed to load segmentation model:', error);
      alert('人像分割模型加载失败，请检查网络连接');
    } finally {
      setModelLoading(false);
    }
  };

  const applyFastBlur = (data: Uint8ClampedArray, width: number, height: number, radius: number) => {
    if (radius <= 1) return;
    
    const temp = new Uint8ClampedArray(data.length);
    const passes = 2;
    
    for (let pass = 0; pass < passes; pass++) {
      const src = pass === 0 ? data : temp;
      const dst = pass === 0 ? temp : data;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let r = 0, g = 0, b = 0, count = 0;
          
          for (let k = -radius; k <= radius; k++) {
            const nx = Math.min(Math.max(x + k, 0), width - 1);
            const idx = (y * width + nx) * 4;
            r += src[idx];
            g += src[idx + 1];
            b += src[idx + 2];
            count++;
          }
          
          const idx = (y * width + x) * 4;
          dst[idx] = Math.round(r / count);
          dst[idx + 1] = Math.round(g / count);
          dst[idx + 2] = Math.round(b / count);
        }
      }
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let r = 0, g = 0, b = 0, count = 0;
          
          for (let k = -radius; k <= radius; k++) {
            const ny = Math.min(Math.max(y + k, 0), height - 1);
            const idx = (ny * width + x) * 4;
            r += src[idx];
            g += src[idx + 1];
            b += src[idx + 2];
            count++;
          }
          
          const idx = (y * width + x) * 4;
          dst[idx] = Math.round(r / count);
          dst[idx + 1] = Math.round(g / count);
          dst[idx + 2] = Math.round(b / count);
        }
      }
    }
    
    if (passes % 2 === 1) {
      data.set(temp);
    }
  };

  const applyPortraitBlur = useCallback((imageData: ImageData) => {
    if (!segmenterRef.current || !videoRef.current) return;
    
    segmentationFrameRef.current++;
    if (segmentationFrameRef.current % SEGMENTATION_SKIP === 0) {
      segmentationFrameRef.current = 0;
      
      (async () => {
        try {
          const segmentation = await segmenterRef.current!.segmentPeople(videoRef.current!, {
            flipHorizontal: false
          });
          
          if (segmentation.length > 0 && segmentation[0].mask) {
            const maskData = await segmentation[0].mask.toImageData();
            segmentationMaskRef.current = maskData.data;
          }
        } catch (e) {
          console.error('Segmentation error:', e);
        }
      })();
    }
    
    if (!segmentationMaskRef.current) return;
    
    const { width, height, data } = imageData;
    const mask = segmentationMaskRef.current;
    const blurRadius = Math.floor(filterStateRef.current.blurIntensity / 3);
    
    const blurred = new Uint8ClampedArray(data);
    applyFastBlur(blurred, width, height, blurRadius);
    
    const step = 4;
    for (let i = 0; i < data.length; i += step) {
      const maskIdx = Math.floor(i / 4);
      const maskValue = mask[maskIdx * 4] || 0;
      
      if (maskValue < 50) {
        data[i] = blurred[i];
        data[i + 1] = blurred[i + 1];
        data[i + 2] = blurred[i + 2];
      } else if (maskValue < 200) {
        const alpha = (maskValue - 50) / 150;
        for (let c = 0; c < 3; c++) {
          data[i + c] = Math.round(blurred[i + c] * (1 - alpha) + data[i + c] * alpha);
        }
      }
    }
  }, []);

  const applyFilterToBuffer = useCallback((imageData: ImageData) => {
    const { currentFilter: filter, intensity: inten, portraitEnabled: portrait } = filterStateRef.current;
    
    if (filter !== 'none') {
      switch (filter) {
        case 'grayscale':
          applyGrayscale(imageData.data, WIDTH, HEIGHT, inten);
          break;
        case 'vintage':
          applyVintage(imageData.data, WIDTH, HEIGHT, inten);
          break;
        case 'sobel':
          applySobelEdge(imageData.data, WIDTH, HEIGHT, inten);
          break;
      }
    }
    
    if (portrait && segmenterRef.current) {
      applyPortraitBlur(imageData);
    }
  }, [applyPortraitBlur]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: WIDTH },
          height: { ideal: HEIGHT },
          facingMode: 'user'
        }
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      video.width = WIDTH;
      video.height = HEIGHT;
      await video.play();
      
      videoRef.current = video;
      setIsStreaming(true);
      startProcessing();
    } catch (error) {
      console.error('无法访问摄像头:', error);
      alert('请允许访问摄像头权限');
    }
  };

  const startProcessing = useCallback(() => {
    if (!videoRef.current || !originalCanvasRef.current || !filteredCanvasRef.current) return;

    const originalCtx = originalCanvasRef.current.getContext('2d', { willReadFrequently: true });
    const filteredCtx = filteredCanvasRef.current.getContext('2d', { willReadFrequently: true });

    if (!originalCtx || !filteredCtx) return;

    originalCanvasRef.current.width = WIDTH;
    originalCanvasRef.current.height = HEIGHT;
    filteredCanvasRef.current.width = WIDTH;
    filteredCanvasRef.current.height = HEIGHT;

    const buffer = doubleBufferRef.current || {
      front: originalCtx.createImageData(WIDTH, HEIGHT),
      back: originalCtx.createImageData(WIDTH, HEIGHT)
    };
    doubleBufferRef.current = buffer;

    originalCtx.drawImage(videoRef.current!, 0, 0, WIDTH, HEIGHT);
    const initialFrame = originalCtx.getImageData(0, 0, WIDTH, HEIGHT);
    buffer.front.data.set(initialFrame.data);
    buffer.back.data.set(initialFrame.data);
    applyFilterToBuffer(buffer.front);
    filteredCtx.putImageData(buffer.front, 0, 0);

    const processFrame = () => {
      if (isProcessingRef.current) {
        animationRef.current = requestAnimationFrame(processFrame);
        return;
      }

      isProcessingRef.current = true;
      const startTime = performance.now();

      try {
        originalCtx.drawImage(videoRef.current!, 0, 0, WIDTH, HEIGHT);

        const rawFrame = originalCtx.getImageData(0, 0, WIDTH, HEIGHT);
        buffer.back.data.set(rawFrame.data);

        applyFilterToBuffer(buffer.back);

        const temp = buffer.front;
        buffer.front = buffer.back;
        buffer.back = temp;

        filteredCtx.putImageData(buffer.front, 0, 0);

        const endTime = performance.now();
        setProcessingTime(Math.round(endTime - startTime));

        frameCountRef.current++;
        if (endTime - lastTimeRef.current >= 1000) {
          setFps(frameCountRef.current);
          frameCountRef.current = 0;
          lastTimeRef.current = endTime;
        }
      } finally {
        isProcessingRef.current = false;
      }

      animationRef.current = requestAnimationFrame(processFrame);
    };

    processFrame();
  }, [applyFilterToBuffer]);

  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const filters: { type: FilterType; label: string }[] = [
    { type: 'none', label: '原图' },
    { type: 'grayscale', label: '灰度' },
    { type: 'vintage', label: '复古' },
    { type: 'sobel', label: '边缘检测' },
  ];

  if (!wasmLoaded) {
    return (
      <div className="app">
        <div className="loading">
          <h2>正在加载 WebAssembly 模块...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="header">
        <h1>🎬 实时视频滤镜</h1>
        <p>基于 Rust + WebAssembly 的高性能视频处理引擎</p>
      </div>

      {!isStreaming ? (
        <button className="start-btn" onClick={startCamera}>
          📷 启动摄像头
        </button>
      ) : (
        <>
          <div className="video-container">
            <div className="video-panel">
              <h3>原始视频</h3>
              <div className="canvas-wrapper">
                <canvas ref={originalCanvasRef} />
              </div>
            </div>
            <div className="video-panel">
              <h3>滤镜处理后</h3>
              <div className="canvas-wrapper">
                <canvas ref={filteredCanvasRef} />
              </div>
            </div>
          </div>

          <div className="controls">
            <h3>滤镜控制</h3>
            
            <div className="filter-buttons">
              {filters.map((filter) => (
                <button
                  key={filter.type}
                  className={`filter-btn ${currentFilter === filter.type ? 'active' : ''}`}
                  onClick={() => setCurrentFilter(filter.type)}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <div className="intensity-control">
              <label>滤镜强度: {Math.round(intensity * 100)}%</label>
              <div className="slider-container">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={intensity}
                  onChange={(e) => setIntensity(parseFloat(e.target.value))}
                  className="slider"
                />
                <span className="intensity-value">{Math.round(intensity * 100)}%</span>
              </div>
            </div>

            <div className="portrait-section">
              <h4>🤖 AI 人像背景虚化</h4>
              
              <div className="toggle-row">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={portraitEnabled}
                    onChange={(e) => {
                      if (e.target.checked && !modelLoaded) {
                        loadSegmentationModel();
                      }
                      setPortraitEnabled(e.target.checked);
                    }}
                    disabled={modelLoading}
                  />
                  <span>启用人像虚化</span>
                </label>
                {modelLoading && <span className="loading-text">正在加载AI模型...</span>}
                {modelLoaded && <span className="ready-text">✓ 模型就绪</span>}
              </div>

              {portraitEnabled && (
                <div className="intensity-control">
                  <label>虚化强度: {blurIntensity}px</label>
                  <div className="slider-container">
                    <input
                      type="range"
                      min="3"
                      max="30"
                      step="1"
                      value={blurIntensity}
                      onChange={(e) => setBlurIntensity(parseInt(e.target.value))}
                      className="slider"
                    />
                    <span className="intensity-value">{blurIntensity}px</span>
                  </div>
                  <p className="hint">💡 低端设备建议降低虚化强度以提高性能</p>
                </div>
              )}
            </div>

            <div className="performance-stats">
              <div className="stat">
                <span className="stat-label">帧率 (FPS)</span>
                <span className="stat-value">{fps}</span>
              </div>
              <div className="stat">
                <span className="stat-label">处理时间 (ms)</span>
                <span className="stat-value">{processingTime}</span>
              </div>
              <div className="stat">
                <span className="stat-label">分辨率</span>
                <span className="stat-value">1080p</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default App;
