<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import GateToolbar from '@/components/GateToolbar.vue';
import CircuitCanvas from '@/components/CircuitCanvas.vue';
import StatePlot from '@/components/StatePlot.vue';
import ControlPanel from '@/components/ControlPanel.vue';
import NoisePanel from '@/components/NoisePanel.vue';
import BlochSphere from '@/components/BlochSphere.vue';
import { useQuantumAPI } from '@/composables/useQuantumAPI';
import type { Gate, StateVector, MeasureResult, GateType, NoiseConfig, BlochCoordinates } from '@/types/quantum';

const { runCircuit, reset, measure, isLoading, error, exportQasm, getBlochCoordinates } = useQuantumAPI();

const numQubits = ref(3);
const circuitGates = ref<Gate[]>([]);
const stateVector = ref<StateVector | null>(null);
const lastMeasureResult = ref<MeasureResult | null>(null);
const blochCoordinates = ref<BlochCoordinates | null>(null);
const blochLoading = ref(false);
let gateIdCounter = 0;

const noiseConfig = ref<NoiseConfig>({
  enabled: false,
  bitFlipProbability: 0.01,
  phaseDampingGamma: 0.01,
});

const showBlochSphere = computed(() => numQubits.value === 1);

function handleAddGate(gateData: Omit<Gate, 'id'>) {
  const newGate: Gate = {
    ...gateData,
    id: `gate_${++gateIdCounter}`,
  };
  circuitGates.value.push(newGate);
}

function handleRemoveGate(gateId: string) {
  circuitGates.value = circuitGates.value.filter(g => g.id !== gateId);
}

function handleClearCircuit() {
  circuitGates.value = [];
  stateVector.value = null;
  lastMeasureResult.value = null;
  blochCoordinates.value = null;
}

async function updateBlochCoordinates() {
  if (numQubits.value !== 1 || !stateVector.value) {
    blochCoordinates.value = null;
    return;
  }

  blochLoading.value = true;
  try {
    blochCoordinates.value = await getBlochCoordinates(1, 0, stateVector.value.state);
  } catch (e) {
    console.error('获取布洛赫坐标失败:', e);
    blochCoordinates.value = null;
  } finally {
    blochLoading.value = false;
  }
}

async function handleRun() {
  try {
    const gatesToSend = circuitGates.value.map(({ id, ...rest }) => rest);
    const result = await runCircuit(gatesToSend, numQubits.value, noiseConfig.value);
    stateVector.value = result;
    lastMeasureResult.value = null;
    await updateBlochCoordinates();
  } catch (e) {
    console.error('运行电路失败:', e);
  }
}

async function handleReset() {
  try {
    const result = await reset(numQubits.value);
    stateVector.value = result;
    lastMeasureResult.value = null;
    await updateBlochCoordinates();
  } catch (e) {
    console.error('重置失败:', e);
  }
}

async function handleMeasure(qubit: number) {
  try {
    const result = await measure(qubit, numQubits.value, stateVector.value?.state);
    lastMeasureResult.value = result;
    if (stateVector.value) {
      stateVector.value = {
        ...stateVector.value,
        state: result.collapsedState,
        probabilities: result.probabilities,
      };
      await updateBlochCoordinates();
    }
  } catch (e) {
    console.error('测量失败:', e);
  }
}

async function handleExportQasm() {
  try {
    const gatesToSend = circuitGates.value.map(({ id, ...rest }) => rest);
    const qasmContent = await exportQasm(gatesToSend, numQubits.value, 'my_circuit');

    const blob = new Blob([qasmContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `circuit_${Date.now()}.qasm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('导出 QASM 失败:', e);
  }
}

function handleNumQubitsChange(value: number) {
  numQubits.value = value;
  circuitGates.value = [];
  stateVector.value = null;
  lastMeasureResult.value = null;
  blochCoordinates.value = null;
}

watch(numQubits, async () => {
  if (numQubits.value === 1) {
    await updateBlochCoordinates();
  } else {
    blochCoordinates.value = null;
  }
});

onMounted(async () => {
  try {
    const { getStateVector } = useQuantumAPI();
    stateVector.value = await getStateVector(numQubits.value);
    if (numQubits.value === 1) {
      await updateBlochCoordinates();
    }
  } catch (e) {
    console.error('获取初始态失败:', e);
  }
});
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
    <header class="border-b border-slate-700/50 backdrop-blur-sm bg-slate-900/50 sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-6 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/30">
              ⚛️
            </div>
            <div>
              <h1 class="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                量子态模拟器
              </h1>
              <p class="text-xs text-slate-400">Quantum State Simulator</p>
            </div>
          </div>
          <div class="flex items-center gap-4">
            <div class="text-right">
              <div class="text-xs text-slate-400">支持量子门</div>
              <div class="text-sm font-mono text-cyan-400">H, X, Y, S, T, CNOT</div>
            </div>
            <div class="w-px h-10 bg-slate-700"></div>
            <div class="text-right">
              <div class="text-xs text-slate-400">最大比特数</div>
              <div class="text-sm font-mono text-cyan-400">12 qubits</div>
            </div>
            <button
              @click="handleExportQasm"
              :disabled="circuitGates.length === 0"
              class="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2"
            >
              <span>📥</span>
              导出 QASM
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-6 py-6">
      <div
        v-if="error"
        class="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400"
      >
        {{ error }}
      </div>

      <div class="grid grid-cols-12 gap-6">
        <div class="col-span-12 lg:col-span-2 space-y-6">
          <GateToolbar @drag-start="() => {}" />
          <NoisePanel v-model="noiseConfig" />
        </div>

        <div class="col-span-12 lg:col-span-7 space-y-6">
          <CircuitCanvas
            :num-qubits="numQubits"
            :gates="circuitGates"
            @add-gate="handleAddGate"
            @remove-gate="handleRemoveGate"
            @clear-circuit="handleClearCircuit"
          />

          <div v-if="showBlochSphere" class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <BlochSphere
              :coordinates="blochCoordinates"
              :loading="blochLoading"
            />
            <StatePlot :state-vector="stateVector" />
          </div>
          <StatePlot v-else :state-vector="stateVector" />
        </div>

        <div class="col-span-12 lg:col-span-3 space-y-6">
          <ControlPanel
            :num-qubits="numQubits"
            :is-running="isLoading"
            :last-measure-result="lastMeasureResult"
            @update:num-qubits="handleNumQubitsChange"
            @run="handleRun"
            @reset="handleReset"
            @measure="handleMeasure"
          />

          <div class="bg-slate-800/50 rounded-xl p-4 backdrop-blur-sm border border-slate-700">
            <h3 class="text-sm font-semibold text-cyan-400 mb-3">电路信息</h3>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-slate-400">量子门数量</span>
                <span class="font-mono text-white">{{ circuitGates.length }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">量子比特数</span>
                <span class="font-mono text-white">{{ numQubits }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">态矢量维度</span>
                <span class="font-mono text-white">2<sup>{{ numQubits }}</sup> = {{ 2 ** numQubits }}</span>
              </div>
              <div v-if="stateVector" class="flex justify-between">
                <span class="text-slate-400">非零态数量</span>
                <span class="font-mono text-white">
                  {{ stateVector.probabilities.filter(p => p > 0.0001).length }}
                </span>
              </div>
              <div v-if="noiseConfig.enabled" class="flex justify-between">
                <span class="text-slate-400">噪声模式</span>
                <span class="font-mono text-orange-400">已启用</span>
              </div>
            </div>
          </div>

          <div v-if="showBlochSphere" class="bg-slate-800/50 rounded-xl p-4 backdrop-blur-sm border border-slate-700">
            <h3 class="text-sm font-semibold text-purple-400 mb-2 flex items-center gap-2">
              <span>💡</span>
              布洛赫球提示
            </h3>
            <p class="text-xs text-slate-400 leading-relaxed">
              布洛赫球可视化单量子比特的量子态。北极是 |0⟩，南极是 |1⟩，球面表示所有可能的量子叠加态。
            </p>
          </div>
        </div>
      </div>

      <div class="mt-8 text-center text-xs text-slate-500">
        <p>💡 使用提示：从左侧拖拽量子门到电路画布，点击运行按钮查看量子态演化</p>
        <p class="mt-1">CNOT 门需要先拖到控制位，再拖到目标位；点击已放置的门可以删除</p>
      </div>
    </main>
  </div>
</template>
