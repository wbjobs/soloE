import React, { useEffect, useRef, useState, useCallback } from 'react';
import { WebGPUContext } from './webgpu/context';
import { BVHBuilder, BuildProgress } from './bvh/builder';
import { RayTracer } from './renderer/raytracer';
import { generateVoxelScene } from './voxel/generator';
import { VoxelEditor, VoxelEditOperation, PickResult } from './voxel/editor';
import { PerformancePanel } from './components/PerformancePanel';
import { VoxelEditorUI, EditMode } from './components/VoxelEditorUI';
import { Camera, RenderSettings, PerformanceMetrics, VoxelData } from './types';

const SCENE_SIZES = {
  small: 128,
  medium: 192,
  large: 256,
} as const;

type SceneSize = keyof typeof SCENE_SIZES;

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('正在初始化 WebGPU...');
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null);
  const [deviceLost, setDeviceLost] = useState(false);
  const [deviceLostMessage, setDeviceLostMessage] = useState('');
  const [sceneSize, setSceneSize] = useState<SceneSize>('small');
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    bvhBuildTime: 0,
    avgTraversalCount: 0,
    fps: 0,
    frameTime: 0,
  });
  const [bvhBuildTime, setBvhBuildTime] = useState(0);
  const [voxelCount, setVoxelCount] = useState(0);
  const [bvhNodeCount, setBvhNodeCount] = useState(0);
  const [sceneType, setSceneType] = useState<'sphere' | 'maze' | 'terrain' | 'checkerboard'>('sphere');
  const [renderSettings, setRenderSettings] = useState<RenderSettings>({
    raysPerPixel: 512,
    maxBounces: 4,
    showBVH: false,
    bvhLevel: 5,
  });
  const [camera, setCamera] = useState<Camera>({
    position: { x: 80, y: 80, z: 180 },
    target: { x: 64, y: 64, z: 64 },
    up: { x: 0, y: 1, z: 0 },
    fov: 60,
  });

  const [editMode, setEditMode] = useState<EditMode>('none');
  const [brushSize, setBrushSize] = useState(1);
  const [voxelValue, setVoxelValue] = useState(180);
  const [lastEditTime, setLastEditTime] = useState(0);

  const rayTracerRef = useRef<RayTracer | null>(null);
  const bvhBuilderRef = useRef<BVHBuilder | null>(null);
  const voxelEditorRef = useRef<VoxelEditor | null>(null);
  const voxelDataRef = useRef<VoxelData | null>(null);
  const animationFrameRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const cameraAngleRef = useRef({ theta: -Math.PI / 2, phi: 0.5, distance: 180 });
  const contextRef = useRef<WebGPUContext | null>(null);
  const renderLoopActiveRef = useRef(false);
  const cameraDataRef = useRef<Float32Array>(new Float32Array(16));

  const getSceneCenter = useCallback(() => {
    const size = SCENE_SIZES[sceneSize];
    return { x: size / 2, y: size / 2, z: size / 2 };
  }, [sceneSize]);

  const updateCameraPosition = useCallback(() => {
    const { theta, phi, distance } = cameraAngleRef.current;
    const center = getSceneCenter();

    const x = center.x + distance * Math.cos(phi) * Math.cos(theta);
    const y = center.y + distance * Math.sin(phi);
    const z = center.z + distance * Math.cos(phi) * Math.sin(theta);

    setCamera((prev) => ({
      ...prev,
      position: { x, y, z },
      target: center,
    }));
  }, [getSceneCenter]);

  const updateCameraDataRef = useCallback((cam: Camera) => {
    const { position, target, up, fov } = cam;

    const forward = normalize({
      x: target.x - position.x,
      y: target.y - position.y,
      z: target.z - position.z,
    });
    const right = normalize(cross(up, forward));
    const cameraUp = cross(forward, right);
    const aspect = window.innerWidth / window.innerHeight;

    const data = new Float32Array(16);
    data[0] = position.x;
    data[1] = position.y;
    data[2] = position.z;
    data[3] = forward.x;
    data[4] = forward.y;
    data[5] = forward.z;
    data[6] = right.x;
    data[7] = right.y;
    data[8] = right.z;
    data[9] = cameraUp.x;
    data[10] = cameraUp.y;
    data[11] = cameraUp.z;
    data[12] = (fov * Math.PI) / 180;
    data[13] = aspect;
    cameraDataRef.current = data;
  }, []);

  function normalize(v: { x: number; y: number; z: number }) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  const getPhaseMessage = (phase: BuildProgress['phase']): string => {
    switch (phase) {
      case 'morton': return '生成 Morton 编码';
      case 'build': return '构建 BVH 节点';
      case 'refit': return '优化包围盒';
      case 'complete': return '构建完成';
      default: return '准备中';
    }
  };

  const rebuildBVH = useCallback(async () => {
    if (!canvasRef.current || !bvhBuilderRef.current || !contextRef.current) return;

    setIsLoading(true);
    setBuildProgress(null);

    const size = SCENE_SIZES[sceneSize];
    setLoadingMessage(`正在生成 ${size}x${size}x${size} 体素场景...`);

    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const voxelData = generateVoxelScene(size, size, size, sceneType);
      voxelDataRef.current = voxelData;

      const center = getSceneCenter();
      cameraAngleRef.current.distance = size * 1.4;
      setCamera((prev) => ({
        ...prev,
        target: center,
        position: {
          x: center.x + size * 1.4 * Math.cos(cameraAngleRef.current.phi) * Math.cos(cameraAngleRef.current.theta),
          y: center.y + size * 1.4 * Math.sin(cameraAngleRef.current.phi),
          z: center.z + size * 1.4 * Math.cos(cameraAngleRef.current.phi) * Math.sin(cameraAngleRef.current.theta),
        },
      }));

      const result = await bvhBuilderRef.current.build(voxelData, true);

      setBvhBuildTime(result.buildTime);
      setVoxelCount(bvhBuilderRef.current.getVoxelCount());
      setBvhNodeCount(result.nodeCount);

      setLoadingMessage('正在初始化渲染器...');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const width = canvasRef.current.width;
      const height = canvasRef.current.height;

      if (rayTracerRef.current) {
        rayTracerRef.current.destroy();
      }

      rayTracerRef.current = new RayTracer(contextRef.current, width, height);

      await rayTracerRef.current.initialize(
        result.buffer,
        bvhBuilderRef.current.getVoxelBuffer(),
        result.nodeCount
      );

      voxelEditorRef.current = new VoxelEditor(contextRef.current, voxelData);

      const bvhNodes = await bvhBuilderRef.current.readbackBVHNodes();
      const bvhNodeData = new Float32Array(bvhNodes.length * 8);
      const parentData = new Int32Array(bvhNodes.length);

      for (let i = 0; i < bvhNodes.length; i++) {
        const node = bvhNodes[i];
        bvhNodeData[i * 8] = node.minX;
        bvhNodeData[i * 8 + 1] = node.minY;
        bvhNodeData[i * 8 + 2] = node.minZ;
        bvhNodeData[i * 8 + 3] = node.leftChild;
        bvhNodeData[i * 8 + 4] = node.maxX;
        bvhNodeData[i * 8 + 5] = node.maxY;
        bvhNodeData[i * 8 + 6] = node.maxZ;
        bvhNodeData[i * 8 + 7] = node.rightChild;

        const isLeaf = node.leftChild === -1 && node.rightChild === -1;
        if (!isLeaf) {
          if (node.leftChild >= 0) parentData[node.leftChild] = i;
          if (node.rightChild >= 0) parentData[node.rightChild] = i;
        } else {
          parentData[i] = -1;
        }
      }
      parentData[bvhNodes.length - 1] = -1;

      voxelEditorRef.current.setBVHBuffers(
        result.buffer,
        bvhBuilderRef.current.getVoxelBuffer(),
        result.nodeCount,
        parentData,
        bvhNodeData
      );

      updateCameraPosition();
    } catch (error) {
      console.error('BVH 构建失败:', error);
      setLoadingMessage(`BVH 构建失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }

    setIsLoading(false);
    setBuildProgress(null);
  }, [sceneType, sceneSize, getSceneCenter, updateCameraPosition]);

  const setupDeviceListeners = useCallback((context: WebGPUContext) => {
    context.onDeviceLost((reason, message) => {
      console.error('WebGPU 设备丢失:', reason, message);
      setDeviceLost(true);
      setDeviceLostMessage(message);
      setIsLoading(true);
      setLoadingMessage(`GPU 设备丢失 (${reason})，正在尝试恢复...`);

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    });

    context.onDeviceRecovered(() => {
      console.log('WebGPU 设备已恢复，正在重建...');
      setDeviceLost(false);
      setDeviceLostMessage('');

      if (canvasRef.current) {
        context.setCanvas(canvasRef.current);
      }

      if (bvhBuilderRef.current) {
        bvhBuilderRef.current.destroy();
      }
      bvhBuilderRef.current = new BVHBuilder(context);
      bvhBuilderRef.current.setOnProgress(setBuildProgress);

      rebuildBVH();
    });
  }, [rebuildBVH]);

  useEffect(() => {
    const init = async () => {
      try {
        const context = await WebGPUContext.getInstance();
        contextRef.current = context;

        setupDeviceListeners(context);

        if (!canvasRef.current) {
          setLoadingMessage('Canvas 未就绪');
          return;
        }

        const width = window.innerWidth;
        const height = window.innerHeight;

        canvasRef.current.width = width;
        canvasRef.current.height = height;

        context.setCanvas(canvasRef.current);

        bvhBuilderRef.current = new BVHBuilder(context);
        bvhBuilderRef.current.setOnProgress((progress) => {
          setBuildProgress(progress);
          const percent = progress.total > 0 ? Math.round((progress.progress / progress.total) * 100) : 0;
          setLoadingMessage(`${getPhaseMessage(progress.phase)}: ${percent}%`);
        });

        rayTracerRef.current = new RayTracer(context, width, height);

        await rebuildBVH();
      } catch (error) {
        console.error('初始化失败:', error);
        setLoadingMessage(`初始化失败: ${error instanceof Error ? error.message : 'WebGPU 可能不受支持'}`);
      }
    };

    init();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      renderLoopActiveRef.current = false;
      bvhBuilderRef.current?.destroy();
      rayTracerRef.current?.destroy();
      voxelEditorRef.current?.destroy();
    };
  }, [setupDeviceListeners, rebuildBVH]);

  useEffect(() => {
    if (!rayTracerRef.current) return;
    rayTracerRef.current.updateCamera(camera);
    updateCameraDataRef(camera);
  }, [camera, updateCameraDataRef]);

  useEffect(() => {
    if (!rayTracerRef.current) return;
    rayTracerRef.current.updateSettings(renderSettings);
  }, [renderSettings]);

  useEffect(() => {
    if (isLoading || !rayTracerRef.current || deviceLost) return;

    if (renderLoopActiveRef.current) return;
    renderLoopActiveRef.current = true;

    let lastTraversalUpdate = 0;

    const renderLoop = async () => {
      if (!rayTracerRef.current || !renderLoopActiveRef.current) return;

      try {
        const newMetrics = rayTracerRef.current.render();
        setMetrics(newMetrics);

        const now = performance.now();
        if (now - lastTraversalUpdate > 2000) {
          lastTraversalUpdate = now;
          try {
            const avgTraversal = await rayTracerRef.current.getAverageTraversalCount();
            setMetrics((prev) => ({ ...prev, avgTraversalCount: avgTraversal }));
          } catch (e) {
            console.warn('无法读取遍历计数:', e);
          }
        }
      } catch (e) {
        console.error('渲染错误:', e);
      }

      animationFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animationFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      renderLoopActiveRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isLoading, deviceLost]);

  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !rayTracerRef.current) return;

      const width = window.innerWidth;
      const height = window.innerHeight;

      canvasRef.current.width = width;
      canvasRef.current.height = height;

      rayTracerRef.current.resize(width, height);
      updateCameraDataRef(camera);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [camera, updateCameraDataRef]);

  const handleCanvasClick = useCallback(async (e: React.MouseEvent) => {
    if (editMode === 'none' || !voxelEditorRef.current || !canvasRef.current || isLoading) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;

    try {
      const pickResult: PickResult = await voxelEditorRef.current.pickVoxel(
        x, y, width, height, cameraDataRef.current
      );

      if (pickResult.hit) {
        const operations: VoxelEditOperation[] = [];

        for (let dz = -(brushSize - 1); dz <= brushSize - 1; dz++) {
          for (let dy = -(brushSize - 1); dy <= brushSize - 1; dy++) {
            for (let dx = -(brushSize - 1); dx <= brushSize - 1; dx++) {
              const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (dist > brushSize - 0.5) continue;

              if (editMode === 'remove') {
                operations.push({
                  type: 'remove',
                  x: pickResult.voxelX + dx,
                  y: pickResult.voxelY + dy,
                  z: pickResult.voxelZ + dz,
                  value: 0,
                });
              } else if (editMode === 'add') {
                const nx = pickResult.voxelX + dx + Math.round(pickResult.normal.x);
                const ny = pickResult.voxelY + dy + Math.round(pickResult.normal.y);
                const nz = pickResult.voxelZ + dz + Math.round(pickResult.normal.z);
                operations.push({
                  type: 'add',
                  x: nx,
                  y: ny,
                  z: nz,
                  value: voxelValue,
                });
              }
            }
          }
        }

        let totalTime = 0;
        for (const op of operations) {
          const result = await voxelEditorRef.current.editVoxel(op);
          totalTime += result.updateTime;
        }

        if (operations.length > 0) {
          setLastEditTime(totalTime);
          setVoxelCount(voxelEditorRef.current.getVoxelCount());

          const buffers = voxelEditorRef.current.getBVHBuffers();
          setBvhNodeCount(buffers.bvhNodeCount);

          if (rayTracerRef.current) {
            rayTracerRef.current.updateBVHBuffers(
              buffers.bvhNodesBuffer,
              buffers.voxelBuffer,
              buffers.bvhNodeCount
            );
          }
        }
      }
    } catch (error) {
      console.error('体素编辑失败:', error);
    }
  }, [editMode, brushSize, voxelValue, isLoading]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editMode !== 'none') {
      handleCanvasClick(e);
      return;
    }
    isDraggingRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || editMode !== 'none') return;

    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;

    cameraAngleRef.current.theta += dx * 0.01;
    cameraAngleRef.current.phi = Math.max(
      -Math.PI / 2 + 0.1,
      Math.min(Math.PI / 2 - 0.1, cameraAngleRef.current.phi + dy * 0.01)
    );

    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    updateCameraPosition();
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const size = SCENE_SIZES[sceneSize];
    cameraAngleRef.current.distance = Math.max(
      size * 0.5,
      Math.min(size * 4, cameraAngleRef.current.distance + e.deltaY * 0.2)
    );
    updateCameraPosition();
  };

  const handleSceneChange = (type: 'sphere' | 'maze' | 'terrain' | 'checkerboard') => {
    setSceneType(type);
  };

  const handleSceneSizeChange = (size: SceneSize) => {
    setSceneSize(size);
  };

  useEffect(() => {
    if (bvhBuilderRef.current && !isLoading) {
      rebuildBVH();
    }
  }, [sceneType, sceneSize]);

  const getProgressPercent = () => {
    if (!buildProgress || buildProgress.total === 0) return 0;
    return Math.round((buildProgress.progress / buildProgress.total) * 100);
  };

  return (
    <div
      ref={containerRef}
      style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: editMode === 'none'
            ? (isDraggingRef.current ? 'grabbing' : 'grab')
            : (editMode === 'add' ? 'crosshair' : 'not-allowed'),
        }}
      />

      {isLoading && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, width: '100%', height: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: '#fff', fontFamily: 'system-ui, sans-serif', zIndex: 1000,
        }}>
          <div style={{
            width: 60, height: 60,
            border: '4px solid rgba(96, 165, 250, 0.2)',
            borderTop: '4px solid #60a5fa',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: 24,
          }} />
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          <h1 style={{
            fontSize: 28, fontWeight: 'bold', marginBottom: 12,
            background: 'linear-gradient(135deg, #60a5fa, #a78bfa)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            WebGPU 体素光线追踪器
          </h1>
          <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 16 }}>{loadingMessage}</p>
          {buildProgress && buildProgress.total > 0 && (
            <div style={{ width: 280, textAlign: 'center' }}>
              <div style={{
                width: '100%', height: 8,
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 4, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${getProgressPercent()}%`, height: '100%',
                  background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                  transition: 'width 0.3s',
                }} />
              </div>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
                {getProgressPercent()}% ({buildProgress.progress.toLocaleString()} / {buildProgress.total.toLocaleString()})
              </p>
            </div>
          )}
          {deviceLost && (
            <p style={{ fontSize: 12, color: '#f87171', marginTop: 16, maxWidth: 300, textAlign: 'center' }}>
              {deviceLostMessage}
            </p>
          )}
        </div>
      )}

      {!isLoading && (
        <>
          <PerformancePanel
            metrics={metrics}
            voxelCount={voxelCount}
            bvhNodeCount={bvhNodeCount}
            bvhBuildTime={bvhBuildTime}
          />
          <div style={{
            position: 'absolute', top: 16, right: 16, padding: 16,
            background: 'rgba(0, 0, 0, 0.8)', color: '#fff',
            borderRadius: 8, fontFamily: 'system-ui, sans-serif',
            fontSize: 13, minWidth: 260, zIndex: 100,
          }}>
            <div style={{
              fontSize: 14, fontWeight: 'bold', marginBottom: 12,
              borderBottom: '1px solid #444', paddingBottom: 8, color: '#60a5fa',
            }}>⚙️ 渲染控制</div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, color: '#d1d5db', fontSize: 12 }}>场景大小</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['small', 'medium', 'large'] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => handleSceneSizeChange(size)}
                    style={{
                      flex: 1, padding: '6px 8px',
                      background: sceneSize === size ? '#3b82f6' : '#1f2937',
                      color: '#fff', border: 'none', borderRadius: 4,
                      cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    {SCENE_SIZES[size]}³
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, color: '#d1d5db', fontSize: 12 }}>场景类型</label>
              <select
                value={sceneType}
                onChange={(e) => handleSceneChange(e.target.value as any)}
                style={{
                  width: '100%', padding: '8px 12px',
                  background: '#1f2937', color: '#fff',
                  border: '1px solid #374151', borderRadius: 6, fontSize: 13,
                }}
              >
                <option value="sphere">球体</option>
                <option value="maze">迷宫</option>
                <option value="terrain">地形</option>
                <option value="checkerboard">棋盘</option>
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, color: '#d1d5db', fontSize: 12 }}>
                光线/像素: {renderSettings.raysPerPixel}
              </label>
              <input
                type="range" min="1" max="512" value={renderSettings.raysPerPixel}
                onChange={(e) => setRenderSettings({ ...renderSettings, raysPerPixel: parseInt(e.target.value) })}
                style={{ width: '100%', accentColor: '#60a5fa' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, color: '#d1d5db', fontSize: 12 }}>
                最大反弹: {renderSettings.maxBounces}
              </label>
              <input
                type="range" min="1" max="10" value={renderSettings.maxBounces}
                onChange={(e) => setRenderSettings({ ...renderSettings, maxBounces: parseInt(e.target.value) })}
                style={{ width: '100%', accentColor: '#60a5fa' }}
              />
            </div>

            <label style={{
              display: 'block', marginBottom: 8, color: '#d1d5db', fontSize: 12,
            }}>
              <input
                type="checkbox" checked={renderSettings.showBVH}
                onChange={(e) => setRenderSettings({ ...renderSettings, showBVH: e.target.checked })}
                style={{ marginRight: 8, accentColor: '#60a5fa' }}
              />
              显示 BVH 线框
            </label>

            {renderSettings.showBVH && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, color: '#d1d5db', fontSize: 12 }}>
                  BVH 层级: {renderSettings.bvhLevel}
                </label>
                <input
                  type="range" min="0" max="20" value={renderSettings.bvhLevel}
                  onChange={(e) => setRenderSettings({ ...renderSettings, bvhLevel: parseInt(e.target.value) })}
                  style={{ width: '100%', accentColor: '#60a5fa' }}
                />
              </div>
            )}

            <button
              onClick={rebuildBVH}
              style={{
                width: '100%', padding: '10px 16px',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color: '#fff', border: 'none', borderRadius: 6,
                cursor: 'pointer', fontWeight: 'bold', fontSize: 13,
              }}
            >
              🔄 重新构建 BVH
            </button>

            <div style={{ marginTop: 16, fontSize: 11, color: '#6b7280' }}>
              <p>💡 拖动鼠标旋转视角</p>
              <p>滚轮缩放场景</p>
            </div>
          </div>

          <VoxelEditorUI
            editMode={editMode}
            onModeChange={setEditMode}
            brushSize={brushSize}
            onBrushSizeChange={setBrushSize}
            voxelValue={voxelValue}
            onVoxelValueChange={setVoxelValue}
            lastEditTime={lastEditTime}
          />
        </>
      )}
    </div>
  );
};

export default App;
