export type GateType = 'H' | 'X' | 'Y' | 'S' | 'T' | 'CNOT';
export type NoiseType = 'bit_flip' | 'phase_damping' | 'depolarizing';

export interface ComplexNumber {
  real: number;
  imag: number;
}

export interface Gate {
  type: GateType;
  qubit: number;
  control?: number;
  step: number;
  id?: string;
}

export interface StateArray {
  real: number[];
  imag: number[];
}

export interface StateVector {
  state: StateArray;
  numQubits: number;
  basisStates: string[];
  probabilities: number[];
}

export interface MeasureResult {
  qubit: number;
  result: 0 | 1;
  collapsedState: StateArray;
  probabilities: number[];
  basisStates: string[];
}

export interface BlochCoordinates {
  x: number;
  y: number;
  z: number;
}

export interface NoiseConfig {
  enabled: boolean;
  bitFlipProbability: number;
  phaseDampingGamma: number;
}

export interface GateInfo {
  type: GateType;
  name: string;
  color: string;
  description: string;
  isTwoQubit: boolean;
}

export const GATE_INFO: Record<GateType, GateInfo> = {
  H: {
    type: 'H',
    name: 'Hadamard',
    color: '#64ffda',
    description: '创建叠加态',
    isTwoQubit: false
  },
  X: {
    type: 'X',
    name: 'Pauli-X',
    color: '#bd93f9',
    description: '量子 NOT 门',
    isTwoQubit: false
  },
  Y: {
    type: 'Y',
    name: 'Pauli-Y',
    color: '#ff5555',
    description: '泡利 Y 门',
    isTwoQubit: false
  },
  S: {
    type: 'S',
    name: 'S Gate',
    color: '#ffb86c',
    description: 'π/2 相位门',
    isTwoQubit: false
  },
  T: {
    type: 'T',
    name: 'T Gate',
    color: '#50fa7b',
    description: 'π/4 相位门',
    isTwoQubit: false
  },
  CNOT: {
    type: 'CNOT',
    name: 'CNOT',
    color: '#ff79c6',
    description: '受控 NOT 门',
    isTwoQubit: true
  }
};
