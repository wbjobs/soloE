import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OctreeManager } from '../lib/OctreeManager';
import { useStore } from '../store/useStore';

export const PointCloudScene = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const octreeManagerRef = useRef<OctreeManager | null>(null);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  const { settings, updateStats } = useStore();

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(50, 30, 50);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI * 0.95;
    controls.minDistance = 1;
    controls.maxDistance = 500;
    controlsRef.current = controls;

    const gridHelper = new THREE.GridHelper(200, 50, 0x333333, 0x222222);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(10);
    scene.add(axesHelper);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const octreeManager = new OctreeManager(scene);
    octreeManagerRef.current = octreeManager;

    const { root, nodes } = OctreeManager.generateMockOctree(4);
    octreeManager.setOctreeData(root, nodes);

    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      controls.update();

      if (cameraRef.current && octreeManagerRef.current) {
        octreeManagerRef.current.update(cameraRef.current);

        frameCountRef.current++;
        const currentTime = performance.now();
        if (currentTime - lastTimeRef.current >= 1000) {
          const fps = Math.round(frameCountRef.current * 1000 / (currentTime - lastTimeRef.current));
          const visiblePoints = octreeManagerRef.current.getLoadedPointCount();
          
          updateStats({
            fps,
            visiblePoints,
            memoryUsage: Math.round(visiblePoints * 16 / 1024 / 1024),
          });

          frameCountRef.current = 0;
          lastTimeRef.current = currentTime;
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();

      rendererRef.current.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);

      if (octreeManagerRef.current) {
        octreeManagerRef.current.dispose();
      }

      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, [updateStats]);

  useEffect(() => {
    if (!octreeManagerRef.current) return;
    octreeManagerRef.current.updatePointSize(settings.pointSize);
  }, [settings.pointSize]);

  useEffect(() => {
    if (!octreeManagerRef.current) return;
    octreeManagerRef.current.updateColorMode(settings.colorMode, settings.uniformColor);
  }, [settings.colorMode, settings.uniformColor]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full outline-none"
      style={{ touchAction: 'none' }}
    />
  );
};
