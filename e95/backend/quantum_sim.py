import numpy as np
from typing import List, Dict, Tuple, Optional


class QuantumSimulator:
    GATE_MATRICES = {
        'H': np.array([[1, 1], [1, -1]], dtype=complex) / np.sqrt(2),
        'X': np.array([[0, 1], [1, 0]], dtype=complex),
        'Y': np.array([[0, -1j], [1j, 0]], dtype=complex),
        'S': np.array([[1, 0], [0, 1j]], dtype=complex),
        'T': np.array([[1, 0], [0, np.exp(1j * np.pi / 4)]], dtype=complex),
    }

    GATE_QASM_NAMES = {
        'H': 'h',
        'X': 'x',
        'Y': 'y',
        'S': 's',
        'T': 't',
        'CNOT': 'cx',
    }

    def __init__(self, num_qubits: int):
        if num_qubits < 1 or num_qubits > 12:
            raise ValueError("Number of qubits must be between 1 and 12")
        self.num_qubits = num_qubits
        self.dim = 2 ** num_qubits
        self.state: Dict[int, complex] = {0: 1.0 + 0.0j}

    def _initialize_state(self) -> Dict[int, complex]:
        return {0: 1.0 + 0.0j}

    def reset(self):
        self.state = self._initialize_state()

    def _to_dense(self) -> np.ndarray:
        dense = np.zeros(self.dim, dtype=complex)
        for idx, amp in self.state.items():
            dense[idx] = amp
        return dense

    def _from_dense(self, dense: np.ndarray):
        self.state = {}
        for idx, amp in enumerate(dense):
            if abs(amp) > 1e-15:
                self.state[idx] = complex(amp)

    def _apply_single_qubit_gate(self, gate: np.ndarray, qubit: int):
        shift = self.num_qubits - 1 - qubit
        mask = 1 << shift
        new_state: Dict[int, complex] = {}

        for idx, amp in self.state.items():
            bit = (idx >> shift) & 1
            other_idx = idx ^ mask

            if bit == 0:
                new_amp_0 = gate[0, 0] * amp
                new_amp_1 = gate[1, 0] * amp
            else:
                new_amp_0 = gate[0, 1] * amp
                new_amp_1 = gate[1, 1] * amp

            if abs(new_amp_0) > 1e-15:
                new_state[idx] = new_state.get(idx, 0j) + new_amp_0
            if abs(new_amp_1) > 1e-15:
                new_state[other_idx] = new_state.get(other_idx, 0j) + new_amp_1

        self.state = new_state

    def _apply_cnot(self, control: int, target: int):
        control_shift = self.num_qubits - 1 - control
        target_shift = self.num_qubits - 1 - target
        target_mask = 1 << target_shift
        new_state: Dict[int, complex] = {}

        for idx, amp in self.state.items():
            control_bit = (idx >> control_shift) & 1
            if control_bit == 1:
                new_idx = idx ^ target_mask
            else:
                new_idx = idx
            new_state[new_idx] = new_state.get(new_idx, 0j) + amp

        self.state = new_state

    def apply_gate(self, gate_type: str, qubit: int, control: Optional[int] = None):
        if gate_type == 'CNOT':
            if control is None:
                raise ValueError("CNOT gate requires a control qubit")
            if control == qubit:
                raise ValueError("Control and target qubits must be different")
            self._apply_cnot(control, qubit)
        else:
            if gate_type not in self.GATE_MATRICES:
                raise ValueError(f"Unknown gate: {gate_type}")
            self._apply_single_qubit_gate(self.GATE_MATRICES[gate_type], qubit)

    def apply_bit_flip_noise(self, qubit: int, probability: float):
        if probability < 0 or probability > 1:
            raise ValueError("Probability must be between 0 and 1")
        if np.random.random() < probability:
            self.apply_gate('X', qubit)

    def apply_phase_damping_noise(self, qubit: int, gamma: float):
        if gamma < 0 or gamma > 1:
            raise ValueError("Gamma must be between 0 and 1")
        if np.random.random() < gamma:
            shift = self.num_qubits - 1 - qubit
            new_state: Dict[int, complex] = {}
            for idx, amp in self.state.items():
                bit = (idx >> shift) & 1
                if bit == 1:
                    new_state[idx] = -amp
                else:
                    new_state[idx] = amp
            self.state = new_state

    def apply_depolarizing_noise(self, qubit: int, probability: float):
        if probability < 0 or probability > 1:
            raise ValueError("Probability must be between 0 and 1")
        r = np.random.random()
        if r < probability / 3:
            self.apply_gate('X', qubit)
        elif r < 2 * probability / 3:
            self.apply_gate('Y', qubit)
        elif r < probability:
            self.apply_gate('Z' if 'Z' in self.GATE_MATRICES else 'S', qubit)

    def measure(self, qubit: int) -> Tuple[int, Dict[int, complex]]:
        shift = self.num_qubits - 1 - qubit
        prob_0 = 0.0
        prob_1 = 0.0

        for idx, amp in self.state.items():
            bit = (idx >> shift) & 1
            prob = abs(amp) ** 2
            if bit == 0:
                prob_0 += prob
            else:
                prob_1 += prob

        total_prob = prob_0 + prob_1
        if total_prob < 1e-15:
            prob_0 = 0.5
            prob_1 = 0.5
        else:
            prob_0 /= total_prob
            prob_1 /= total_prob

        result = 0 if np.random.random() < prob_0 else 1
        prob = prob_0 if result == 0 else prob_1

        new_state: Dict[int, complex] = {}
        if prob > 1e-15:
            normalization = np.sqrt(prob * total_prob) if total_prob > 1e-15 else np.sqrt(prob)
            for idx, amp in self.state.items():
                bit = (idx >> shift) & 1
                if bit == result:
                    new_state[idx] = amp / normalization

        self.state = new_state
        return result, new_state.copy()

    def get_single_qubit_bloch_coordinates(self, qubit: int) -> Dict[str, float]:
        if self.num_qubits != 1:
            raise ValueError("Bloch sphere visualization only available for 1 qubit")
        
        dense = self._to_dense()
        alpha = dense[0]
        beta = dense[1]
        
        norm_alpha = abs(alpha)
        norm_beta = abs(beta)
        
        phi = 0.0
        if abs(norm_alpha) > 1e-15:
            phi = np.angle(beta) - np.angle(alpha)
        
        theta = 2 * np.arccos(min(1.0, norm_alpha))
        
        x = float(np.sin(theta) * np.cos(phi))
        y = float(np.sin(theta) * np.sin(phi))
        z = float(np.cos(theta))
        
        return {'x': x, 'y': y, 'z': z}

    def get_state_vector(self) -> Dict[str, List[float]]:
        dense = self._to_dense()
        return {
            'real': [float(c.real) for c in dense],
            'imag': [float(c.imag) for c in dense]
        }

    def get_basis_states(self) -> List[str]:
        return [f"|{format(i, f'0{self.num_qubits}b')}⟩" for i in range(self.dim)]

    def get_probabilities(self) -> List[float]:
        dense = self._to_dense()
        return [float(abs(c) ** 2) for c in dense]

    def set_state_from_dense(self, real: List[float], imag: List[float]):
        self.state = {}
        for i in range(len(real)):
            r = real[i]
            im = imag[i]
            if abs(r) > 1e-15 or abs(im) > 1e-15:
                self.state[i] = complex(r, im)

    @staticmethod
    def gate_to_qasm(gate_type: str, qubit: int, control: Optional[int] = None) -> str:
        qasm_name = QuantumSimulator.GATE_QASM_NAMES.get(gate_type, gate_type.lower())
        if gate_type == 'CNOT' and control is not None:
            return f"{qasm_name} q[{control}], q[{qubit}];"
        return f"{qasm_name} q[{qubit}];"

    @classmethod
    def get_available_gates(cls) -> List[str]:
        return list(cls.GATE_MATRICES.keys()) + ['CNOT']
