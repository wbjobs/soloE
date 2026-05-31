import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CubeData } from '../utils/cubeParser';
import { generateIsosurface } from '../utils/marchingCubes';

interface OrbitalViewerProps {
  cubeData: CubeData;
  positiveIso: number;
  negativeIso: number;
  showPositive: boolean;
  showNegative: boolean;
  opacity: number;
}

const Isosurface: React.FC<{
  cubeData: CubeData;
  isovalue: number;
  color: string;
  opacity: number;
  visible: boolean;
}> = ({ cubeData, isovalue, color, opacity, visible }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    if (!visible) return;

    const startTime = performance.now();
    const geometry = generateIsosurface(cubeData, isovalue);
    geometryRef.current = geometry;

    if (meshRef.current) {
      meshRef.current.geometry.dispose();
      meshRef.current.geometry = geometry;
    }
  }, [cubeData, isovalue, visible]);

  if (!visible) return null;

  return (
    <mesh ref={meshRef}>
      <bufferGeometry />
      <meshPhysicalMaterial
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        roughness={0.1}
        metalness={0.1}
        clearcoat={1}
        clearcoatRoughness={0.1}
      />
    </mesh>
  );
};

const VolumeSlice: React.FC<{
  cubeData: CubeData;
}> = ({ cubeData }) => {
  const textureRef = useRef<THREE.DataTexture | null>(null);

  const texture = useMemo(() => {
    const { dimensions, values } = cubeData;
    const sliceZ = Math.floor(dimensions.nz / 2);

    const data = new Uint8Array(dimensions.nx * dimensions.ny * 4);

    for (let y = 0; y < dimensions.ny; y++) {
      for (let x = 0; x < dimensions.nx; x++) {
        const idx = x + y * dimensions.nx + sliceZ * dimensions.nx * dimensions.ny;
        const val = values[idx];

        const normalized = Math.max(0, Math.min(1, (val - cubeData.minValue) / (cubeData.maxValue - cubeData.minValue)));

        const pixelIdx = (x + y * dimensions.nx) * 4;

        if (val > 0) {
          data[pixelIdx] = Math.floor(normalized * 0);
          data[pixelIdx + 1] = Math.floor(normalized * 255);
          data[pixelIdx + 2] = Math.floor(normalized * 255);
          data[pixelIdx + 3] = Math.floor(normalized * 200);
        } else {
          data[pixelIdx] = Math.floor(Math.abs(normalized) * 255);
          data[pixelIdx + 1] = Math.floor(Math.abs(normalized) * 0);
          data[pixelIdx + 2] = Math.floor(Math.abs(normalized) * 100);
          data[pixelIdx + 3] = Math.floor(Math.abs(normalized) * 200);
        }
      }
    }

    const tex = new THREE.DataTexture(
      data,
      dimensions.nx,
      dimensions.ny,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    tex.needsUpdate = true;
    return tex;
  }, [cubeData]);

  const scaleX = cubeData.dimensions.nx * cubeData.voxelSize.x;
  const scaleY = cubeData.dimensions.ny * cubeData.voxelSize.y;

  return (
    <mesh position={[0, 0, cubeData.dimensions.nz * cubeData.voxelSize.z / 2]}>
      <planeGeometry args={[scaleX, scaleY]} />
      <meshBasicMaterial map={texture} transparent side={THREE.DoubleSide} />
    </mesh>
  );
};

const OrbitalScene: React.FC<OrbitalViewerProps> = ({
  cubeData,
  positiveIso,
  negativeIso,
  showPositive,
  showNegative,
  opacity
}) => {
  const orbitControlsRef = useRef<any>(null);

  useEffect(() => {
    if (orbitControlsRef.current) {
      const center = new THREE.Vector3(
        cubeData.dimensions.nx * cubeData.voxelSize.x / 2,
        cubeData.dimensions.ny * cubeData.voxelSize.y / 2,
        cubeData.dimensions.nz * cubeData.voxelSize.z / 2
      );
      orbitControlsRef.current.target.copy(center);
    }
  }, [cubeData]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={1} />
      <directionalLight position={[-10, -10, -10]} intensity={0.5} />
      <pointLight position={[0, 0, 10]} intensity={0.5} />

      {showPositive && (
        <Isosurface
          cubeData={cubeData}
          isovalue={positiveIso}
          color="#00ffff"
          opacity={opacity}
          visible={showPositive}
        />
      )}

      {showNegative && (
        <Isosurface
          cubeData={cubeData}
          isovalue={negativeIso}
          color="#ff4444"
          opacity={opacity}
          visible={showNegative}
        />
      )}

      <gridHelper args={[Math.max(cubeData.dimensions.nx, cubeData.dimensions.ny) * cubeData.voxelSize.x, 20, '#444444', '#333333']} />
    </>
  );
};

const OrbitalViewer: React.FC<OrbitalViewerProps> = (props) => {
  return (
    <Canvas
      camera={{ position: [0, 0, 30], fov: 50 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: 'linear-gradient(to bottom, #0f172a, #1e293b)' }}
    >
      <OrbitalScene {...props} />
    </Canvas>
  );
};

export default OrbitalViewer;
