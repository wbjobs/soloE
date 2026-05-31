from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from typing import List, Optional, Dict
from quantum_sim import QuantumSimulator

app = FastAPI(title="Quantum State Simulator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StateInput(BaseModel):
    real: List[float]
    imag: List[float]


class GateRequest(BaseModel):
    gate: str
    qubit: int
    control: Optional[int] = None
    state: Optional[StateInput] = None
    numQubits: int = 3


class MeasureRequest(BaseModel):
    qubit: int
    state: Optional[StateInput] = None
    numQubits: int = 3


class CircuitGate(BaseModel):
    type: str
    qubit: int
    control: Optional[int] = None
    step: int


class RunCircuitRequest(BaseModel):
    gates: List[CircuitGate]
    numQubits: int
    bitFlipProbability: Optional[float] = None
    phaseDampingGamma: Optional[float] = None


class ResetRequest(BaseModel):
    numQubits: int


class NoiseRequest(BaseModel):
    noiseType: str
    qubit: int
    probability: float
    state: Optional[StateInput] = None
    numQubits: int = 3


class ExportQasmRequest(BaseModel):
    gates: List[CircuitGate]
    numQubits: int
    circuitName: Optional[str] = "quantum_circuit"


def get_or_create_simulator(num_qubits: int, state: Optional[StateInput] = None) -> QuantumSimulator:
    sim = QuantumSimulator(num_qubits)
    if state is not None:
        sim.set_state_from_dense(state.real, state.imag)
    return sim


def dict_state_to_response(state_dict: Dict[int, complex], dim: int) -> Dict[str, List[float]]:
    real = [0.0] * dim
    imag = [0.0] * dim
    for idx, amp in state_dict.items():
        if 0 <= idx < dim:
            real[idx] = float(amp.real)
            imag[idx] = float(amp.imag)
    return {"real": real, "imag": imag}


@app.get("/")
async def root():
    return {"message": "Quantum State Simulator API", "gates": QuantumSimulator.get_available_gates()}


@app.get("/state_vector")
async def get_state_vector(numQubits: int = 3):
    sim = get_or_create_simulator(numQubits)
    return {
        "state": sim.get_state_vector(),
        "numQubits": numQubits,
        "basisStates": sim.get_basis_states(),
        "probabilities": sim.get_probabilities()
    }


@app.post("/apply_gate")
async def apply_gate(request: GateRequest):
    try:
        sim = get_or_create_simulator(request.numQubits, request.state)
        sim.apply_gate(request.gate, request.qubit, request.control)
        return {
            "state": sim.get_state_vector(),
            "numQubits": request.numQubits,
            "basisStates": sim.get_basis_states(),
            "probabilities": sim.get_probabilities()
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/apply_noise")
async def apply_noise(request: NoiseRequest):
    try:
        sim = get_or_create_simulator(request.numQubits, request.state)
        if request.noiseType == 'bit_flip':
            sim.apply_bit_flip_noise(request.qubit, request.probability)
        elif request.noiseType == 'phase_damping':
            sim.apply_phase_damping_noise(request.qubit, request.probability)
        elif request.noiseType == 'depolarizing':
            sim.apply_depolarizing_noise(request.qubit, request.probability)
        else:
            raise ValueError(f"Unknown noise type: {request.noiseType}")
        return {
            "state": sim.get_state_vector(),
            "numQubits": request.numQubits,
            "basisStates": sim.get_basis_states(),
            "probabilities": sim.get_probabilities()
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/measure")
async def measure(request: MeasureRequest):
    try:
        sim = get_or_create_simulator(request.numQubits, request.state)
        result, collapsed_state = sim.measure(request.qubit)
        return {
            "qubit": request.qubit,
            "result": result,
            "collapsedState": dict_state_to_response(collapsed_state, sim.dim),
            "probabilities": sim.get_probabilities(),
            "basisStates": sim.get_basis_states()
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/run_circuit")
async def run_circuit(request: RunCircuitRequest):
    try:
        sim = get_or_create_simulator(request.numQubits)
        sorted_gates = sorted(request.gates, key=lambda g: g.step)
        for gate in sorted_gates:
            sim.apply_gate(gate.type, gate.qubit, gate.control)
            if request.bitFlipProbability is not None:
                sim.apply_bit_flip_noise(gate.qubit, request.bitFlipProbability)
            if request.phaseDampingGamma is not None:
                sim.apply_phase_damping_noise(gate.qubit, request.phaseDampingGamma)
        return {
            "state": sim.get_state_vector(),
            "numQubits": request.numQubits,
            "basisStates": sim.get_basis_states(),
            "probabilities": sim.get_probabilities()
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/reset")
async def reset(request: ResetRequest):
    sim = get_or_create_simulator(request.numQubits)
    return {
        "state": sim.get_state_vector(),
        "numQubits": request.numQubits,
        "basisStates": sim.get_basis_states(),
        "probabilities": sim.get_probabilities()
    }


@app.get("/bloch_coordinates")
async def get_bloch_coordinates(numQubits: int = 1, qubit: int = 0, state: Optional[str] = None):
    try:
        sim = get_or_create_simulator(numQubits)
        if state:
            import json
            state_data = json.loads(state)
            sim.set_state_from_dense(state_data['real'], state_data['imag'])
        coords = sim.get_single_qubit_bloch_coordinates(qubit)
        return coords
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/export_qasm", response_class=PlainTextResponse)
async def export_qasm(request: ExportQasmRequest):
    try:
        qasm_lines = [
            "OPENQASM 2.0;",
            'include "qelib1.inc";',
            "",
            f"qreg q[{request.numQubits}];",
            f"creg c[{request.numQubits}];",
            ""
        ]

        sorted_gates = sorted(request.gates, key=lambda g: g.step)
        for gate in sorted_gates:
            qasm_line = QuantumSimulator.gate_to_qasm(gate.type, gate.qubit, gate.control)
            qasm_lines.append(qasm_line)

        for i in range(request.numQubits):
            qasm_lines.append(f"measure q[{i}] -> c[{i}];")

        qasm_content = "\n".join(qasm_lines)
        return qasm_content
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/gates")
async def get_available_gates():
    return {"gates": QuantumSimulator.get_available_gates()}


@app.get("/noise_types")
async def get_noise_types():
    return {
        "noiseTypes": [
            {"id": "bit_flip", "name": "比特翻转", "description": "以概率 p 翻转量子比特 (X 门)"},
            {"id": "phase_damping", "name": "相位阻尼", "description": "以概率 γ 引入相位阻尼 (Z 门)"},
            {"id": "depolarizing", "name": "去极化", "description": "以概率 p 随机应用 X/Y/Z 门"}
        ]
    }
