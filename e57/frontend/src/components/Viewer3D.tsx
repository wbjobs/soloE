import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, ThreeEvent, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Atom, Bond, MoleculeData } from '../types';
import { getElementColor, getElementRadius } from '../utils/colors';

const LOD_DISTANCE_HIGH = 8;
const LOD_DISTANCE_MEDIUM = 25;
const LOD_DISTANCE_POINTS = 50;

const GRID_CELL_SIZE = 10;

interface MoleculeProps {
  data: MoleculeData;
  onAtomClick: (atom: Atom) => void;
  selectedAtoms: number[];
}

class SpatialGrid {
  private grid: Map<string, number[]> = new Map();

  constructor(atoms: Atom[]) {
    atoms.forEach((atom, index) => {
      const key = this.getKey(atom.x, atom.y, atom.z);
      if (!this.grid.has(key)) {
        this.grid.set(key, []);
      }
      this.grid.get(key)!.push(index);
    });
  }

  private getKey(x: number, y: number, z: number): string {
    const gx = Math.floor(x / GRID_CELL_SIZE);
    const gy = Math.floor(y / GRID_CELL_SIZE);
    const gz = Math.floor(z / GRID_CELL_SIZE);
    return `${gx},${gy},${gz}`;
  }

  queryFrustum(frustum: THREE.Frustum, cameraPos: THREE.Vector3): number[] {
    const visibleIndices: number[] = [];

    this.grid.forEach((indices, key) => {
      const [gx, gy, gz] = key.split(',').map(Number);
      const center = new THREE.Vector3(
        (gx + 0.5) * GRID_CELL_SIZE,
        (gy + 0.5) * GRID_CELL_SIZE,
        (gz + 0.5) * GRID_CELL_SIZE
      );

      const distance = cameraPos.distanceTo(center);
      if (distance > LOD_DISTANCE_POINTS + GRID_CELL_SIZE) return;

      const sphere = new THREE.Sphere(center, GRID_CELL_SIZE * Math.SQRT1_2);
      if (frustum.intersectsSphere(sphere)) {
        visibleIndices.push(...indices);
      }
    });

    return visibleIndices;
  }
}

const Molecule: React.FC<MoleculeProps> = ({ data, onAtomClick, selectedAtoms }) => {
  const [hoveredAtom, setHoveredAtom] = useState<number | null>(null);
  const instancedMeshesRef = useRef<Map<string, THREE.InstancedMesh>>(new Map());
  const pointsRef = useRef<THREE.Points>(null);
  const frustum = useRef(new THREE.Frustum());
  const projScreenMatrix = useRef(new THREE.Matrix4());
  const visibleIndicesRef = useRef<number[]>([]);
  const visibleSetRef = useRef<Set<number>>(new Set());
  const dummy = useRef(new THREE.Object3D());

  const spatialGrid = useMemo(() => new SpatialGrid(data.atoms), [data.atoms]);

  const atomsByElement = useMemo(() => {
    const groups: Record<string, { atom: Atom; originalIndex: number }[]> = {};
    data.atoms.forEach((atom, index) => {
      if (!groups[atom.element]) {
        groups[atom.element] = [];
      }
      groups[atom.element].push({ atom, originalIndex: index });
    });
    return groups;
  }, [data.atoms]);

  const elementToIndices = useMemo(() => {
    const map = new Map<string, number[]>();
    Object.entries(atomsByElement).forEach(([element, atoms]) => {
      map.set(element, atoms.map(a => a.originalIndex));
    });
    return map;
  }, [atomsByElement]);

  const atomPositions = useMemo(() => {
    const arr = new Float32Array(data.atoms.length * 3);
    data.atoms.forEach((atom, i) => {
      arr[i * 3] = atom.x;
      arr[i * 3 + 1] = atom.y;
      arr[i * 3 + 2] = atom.z;
    });
    return arr;
  }, [data.atoms]);

  const pointCloudGeometry = useMemo(() => {
    const positions = new Float32Array(data.atoms.length * 3);
    const colors = new Float32Array(data.atoms.length * 3);
    data.atoms.forEach((atom, i) => {
      positions[i * 3] = atom.x;
      positions[i * 3 + 1] = atom.y;
      positions[i * 3 + 2] = atom.z;
      const color = new THREE.Color(getElementColor(atom.element));
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }, [data.atoms]);

  const bondsGeometry = useMemo(() => {
    const positions: number[] = [];
    data.bonds.forEach(bond => {
      const atom1 = data.atoms[bond.atom1];
      const atom2 = data.atoms[bond.atom2];
      if (atom1 && atom2) {
        positions.push(
          atom1.x, atom1.y, atom1.z,
          atom2.x, atom2.y, atom2.z
        );
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }, [data]);

  const atomRadius = useMemo(() => {
    return data.atoms.map(atom => getElementRadius(atom.element));
  }, [data.atoms]);

  useFrame(({ camera }) => {
      projScreenMatrix.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.current.setFromProjectionMatrix(projScreenMatrix.current);

      const cameraPos = camera.position;
      const cameraDistance = cameraPos.length();

      visibleIndicesRef.current = spatialGrid.queryFrustum(frustum.current, cameraPos);
      visibleSetRef.current = new Set(visibleIndicesRef.current);

      if (cameraDistance < LOD_DISTANCE_POINTS) {
        if (pointsRef.current) {
          pointsRef.current.visible = false;
        }

        Object.entries(atomsByElement).forEach(([element, atoms]) => {
          const mesh = instancedMeshesRef.current.get(element);
          if (!mesh) return;

          const elementIndices = elementToIndices.get(element) || [];
          let visibleCount = 0;

          for (let i = 0; i < atoms.length; i++) {
            const { atom, originalIndex } = atoms[i];
            if (!visibleSetRef.current.has(originalIndex)) continue;

            const dx = cameraPos.x - atom.x;
            const dy = cameraPos.y - atom.y;
            const dz = cameraPos.z - atom.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (distance > LOD_DISTANCE_POINTS) continue;

            let scale: number;
            if (distance < LOD_DISTANCE_HIGH) {
              scale = atomRadius[originalIndex] * 2;
            } else if (distance < LOD_DISTANCE_MEDIUM) {
              scale = atomRadius[originalIndex] * 1.5;
            } else {
              scale = atomRadius[originalIndex] * 0.8;
            }

            dummy.current.position.set(atom.x, atom.y, atom.z);
            dummy.current.scale.setScalar(scale);
            dummy.current.updateMatrix();

            mesh.setMatrixAt(visibleCount, dummy.current.matrix);
            mesh.instanceMatrix.array[visibleCount * 16 + 15] = originalIndex;
            visibleCount++;
          }

          mesh.count = visibleCount;
          mesh.instanceMatrix.needsUpdate = true;
        });
      } else {
        Object.entries(atomsByElement).forEach(([element]) => {
          const mesh = instancedMeshesRef.current.get(element);
          if (mesh) mesh.count = 0;
        });
        if (pointsRef.current) {
          pointsRef.current.visible = true;
        }
      }
    });

  const handleInstancedClick = useCallback((e: ThreeEvent<MouseEvent>, element: string) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) {
      const mesh = instancedMeshesRef.current.get(element);
      if (mesh) {
        const originalIndex = Math.floor(mesh.instanceMatrix.array[e.instanceId * 16 + 15]);
        onAtomClick(data.atoms[originalIndex]);
      }
    }
  }, [data.atoms, onAtomClick]);

  const handlePointsClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.point) {
      let closestIndex = -1;
      let closestDist = Infinity;

      visibleIndicesRef.current.forEach((i) => {
        const dx = e.point.x - atomPositions[i * 3];
        const dy = e.point.y - atomPositions[i * 3 + 1];
        const dz = e.point.z - atomPositions[i * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < closestDist) {
          closestDist = dist;
          closestIndex = i;
        }
      });

      if (closestIndex >= 0 && closestDist < 3) {
        onAtomClick(data.atoms[closestIndex]);
      }
    }
  }, [data.atoms, atomPositions, onAtomClick]);

  useEffect(() => {
    return () => {
      instancedMeshesRef.current.forEach(mesh => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      if (pointsRef.current?.geometry) {
        pointsRef.current.geometry.dispose();
      }
    };
  }, []);

  return (
    <group>
      {Object.entries(atomsByElement).map(([element, atoms]) => (
        <instancedMesh
          key={element}
          ref={(el) => {
            if (el) instancedMeshesRef.current.set(element, el);
          }}
          args={[undefined, undefined, atoms.length]}
          onClick={(e) => handleInstancedClick(e, element)}
          onPointerMove={(e) => {
            e.stopPropagation();
            if (e.instanceId !== undefined) {
              const mesh = instancedMeshesRef.current.get(element);
              if (mesh) {
                const originalIndex = Math.floor(mesh.instanceMatrix.array[e.instanceId * 16 + 15]);
                setHoveredAtom(originalIndex);
              }
            }
          }}
          onPointerOut={() => setHoveredAtom(null)}
        >
          <sphereGeometry args={[0.5, 12, 12]} />
          <meshStandardMaterial
            roughness={0.4}
            metalness={0.05}
            color={getElementColor(element)}
          />
        </instancedMesh>
      ))}

      <points
        ref={pointsRef}
        geometry={pointCloudGeometry}
        onClick={handlePointsClick}
        visible={false}
      >
        <pointsMaterial size={0.4} vertexColors sizeAttenuation transparent opacity={0.95} />
      </points>

      <lineSegments geometry={bondsGeometry}>
        <lineBasicMaterial color="#5a6b7c" linewidth={1} transparent opacity={0.7} />
      </lineSegments>

      {selectedAtoms.map((atomId) => {
        const atom = data.atoms[atomId];
        if (!atom) return null;
        return (
          <mesh key={`selected-${atomId}`} position={[atom.x, atom.y, atom.z]}>
            <sphereGeometry args={[getElementRadius(atom.element) * 2.5, 16, 16]} />
            <meshBasicMaterial color="#00ffff" transparent opacity={0.3} side={THREE.DoubleSide} />
          </mesh>
        );
      })}

      {hoveredAtom !== null && (
        <mesh position={[
          atomPositions[hoveredAtom * 3],
          atomPositions[hoveredAtom * 3 + 1],
          atomPositions[hoveredAtom * 3 + 2]
        ]}>
          <sphereGeometry args={[getElementRadius(data.atoms[hoveredAtom].element) * 2.2, 12, 12]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.2} />
        </mesh>
      )}
    </group>
  );
};

interface MeasurementLineProps {
  atom1: Atom | null;
  atom2: Atom | null;
}

const MeasurementLine: React.FC<MeasurementLineProps> = ({ atom1, atom2 }) => {
  if (!atom1 || !atom2) return null;

  return (
    <group>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={2}
            array={new Float32Array([
              atom1.x, atom1.y, atom1.z,
              atom2.x, atom2.y, atom2.z
            ])}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#00ffff" linewidth={3} />
      </lineSegments>

      <mesh position={[(atom1.x + atom2.x) / 2, (atom1.y + atom2.y) / 2, (atom1.z + atom2.z) / 2]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshBasicMaterial color="#00ffff" />
      </mesh>
    </group>
  );
};

interface Viewer3DProps {
  moleculeData: MoleculeData | null;
  onAtomClick: (atom: Atom) => void;
  selectedAtom: Atom | null;
  measurement: {
    firstAtom: Atom | null;
    secondAtom: Atom | null;
  };
}

const Viewer3D: React.FC<Viewer3DProps> = ({ moleculeData, onAtomClick, selectedAtom, measurement }) => {
  const selectedAtoms = useMemo(() => {
    const ids: number[] = [];
    if (selectedAtom) ids.push(selectedAtom.id);
    if (measurement.firstAtom && measurement.firstAtom.id !== selectedAtom?.id) {
      ids.push(measurement.firstAtom.id);
    }
    if (measurement.secondAtom && measurement.secondAtom.id !== selectedAtom?.id) {
      ids.push(measurement.secondAtom.id);
    }
    return ids;
  }, [selectedAtom, measurement]);

  return (
    <div className="w-full h-full bg-gradient-to-b from-slate-900 to-slate-950">
      <Canvas
        camera={{ position: [15, 15, 15], fov: 50, near: 0.1, far: 1000 }}
        gl={{
          antialias: false,
          powerPreference: 'high-performance',
          alpha: false,
          stencil: false,
          depth: true
        }}
        dpr={[1, 1.5]}
        performance={{ min: 0.5 }}
      >
        <color attach="background" args={['#0a0f1a']} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[10, 10, 10]} intensity={1} />
        <directionalLight position={[-10, -10, -10]} intensity={0.25} />

        {moleculeData && (
          <>
            <Molecule
              data={moleculeData}
              onAtomClick={onAtomClick}
              selectedAtoms={selectedAtoms}
            />
            <MeasurementLine
              atom1={measurement.firstAtom}
              atom2={measurement.secondAtom}
            />
          </>
        )}

        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          minDistance={5}
          maxDistance={300}
        />

        {!moleculeData && (
          <group>
            <mesh>
              <sphereGeometry args={[2, 16, 16]} />
              <meshStandardMaterial color="#444" wireframe transparent opacity={0.3} />
            </mesh>
          </group>
        )}
      </Canvas>

      {!moleculeData && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-slate-800 flex items-center justify-center">
              <svg className="w-12 h-12 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">暂无分子数据</h2>
            <p className="text-slate-400">点击上方"上传PDB文件"按钮加载分子结构</p>
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-4 bg-slate-800/80 backdrop-blur-sm rounded-lg px-4 py-2 text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <span>🖱️ 拖拽旋转</span>
          <span>📜 滚轮缩放</span>
          <span>⌨️ 右键平移</span>
          {moleculeData && (
            <span className="text-cyan-400">⚛️ {moleculeData.atoms.length.toLocaleString()} 原子</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default Viewer3D;
