import { ref } from 'vue';
import type { Gate, StateVector, MeasureResult, StateArray, BlochCoordinates, NoiseConfig } from '@/types/quantum';

const API_BASE = 'http://localhost:8000';

export function useQuantumAPI() {
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  async function request<T>(url: string, options?: RequestInit): Promise<T> {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await fetch(`${API_BASE}${url}`, {
        headers: {
          'Content-Type': 'application/json',
        },
        ...options,
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'API 请求失败');
      }
      return await response.json();
    } catch (e) {
      error.value = e instanceof Error ? e.message : '未知错误';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function getStateVector(numQubits: number): Promise<StateVector> {
    return request<StateVector>(`/state_vector?numQubits=${numQubits}`);
  }

  async function applyGate(
    gate: string,
    qubit: number,
    numQubits: number,
    control?: number,
    state?: StateArray
  ): Promise<StateVector> {
    return request<StateVector>('/apply_gate', {
      method: 'POST',
      body: JSON.stringify({ gate, qubit, control, state, numQubits }),
    });
  }

  async function applyNoise(
    noiseType: string,
    qubit: number,
    probability: number,
    numQubits: number,
    state?: StateArray
  ): Promise<StateVector> {
    return request<StateVector>('/apply_noise', {
      method: 'POST',
      body: JSON.stringify({ noiseType, qubit, probability, state, numQubits }),
    });
  }

  async function measure(
    qubit: number,
    numQubits: number,
    state?: StateArray
  ): Promise<MeasureResult> {
    return request<MeasureResult>('/measure', {
      method: 'POST',
      body: JSON.stringify({ qubit, state, numQubits }),
    });
  }

  async function runCircuit(gates: Gate[], numQubits: number, noiseConfig?: NoiseConfig): Promise<StateVector> {
    const body: any = { gates, numQubits };
    if (noiseConfig?.enabled) {
      if (noiseConfig.bitFlipProbability > 0) {
        body.bitFlipProbability = noiseConfig.bitFlipProbability;
      }
      if (noiseConfig.phaseDampingGamma > 0) {
        body.phaseDampingGamma = noiseConfig.phaseDampingGamma;
      }
    }
    return request<StateVector>('/run_circuit', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async function reset(numQubits: number): Promise<StateVector> {
    return request<StateVector>('/reset', {
      method: 'POST',
      body: JSON.stringify({ numQubits }),
    });
  }

  async function getBlochCoordinates(numQubits: number, qubit: number, state?: StateArray): Promise<BlochCoordinates> {
    let url = `/bloch_coordinates?numQubits=${numQubits}&qubit=${qubit}`;
    if (state) {
      url += `&state=${encodeURIComponent(JSON.stringify(state))}`;
    }
    return request<BlochCoordinates>(url);
  }

  async function exportQasm(gates: Gate[], numQubits: number, circuitName: string = 'quantum_circuit'): Promise<string> {
    const response = await fetch(`${API_BASE}/export_qasm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gates, numQubits, circuitName }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || '导出 QASM 失败');
    }
    return await response.text();
  }

  async function getNoiseTypes(): Promise<{noiseTypes: Array<{id: string, name: string, description: string}>}> {
    return request<{noiseTypes: Array<{id: string, name: string, description: string}>}>('/noise_types');
  }

  return {
    isLoading,
    error,
    getStateVector,
    applyGate,
    applyNoise,
    measure,
    runCircuit,
    reset,
    getBlochCoordinates,
    exportQasm,
    getNoiseTypes,
  };
}
