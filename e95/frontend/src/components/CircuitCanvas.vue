<script setup lang="ts">
import { ref, computed } from 'vue';
import { GATE_INFO, type Gate, type GateType } from '@/types/quantum';

const props = defineProps<{
  numQubits: number;
  gates: Gate[];
}>();

const emit = defineEmits<{
  (e: 'addGate', gate: Omit<Gate, 'id'>): void;
  (e: 'removeGate', gateId: string): void;
  (e: 'clearCircuit'): void;
}>();

const maxSteps = ref(10);
const draggingGate = ref<GateType | null>(null);
const pendingCnotControl = ref<number | null>(null);

const CELL_WIDTH = 64;
const CELL_HEIGHT = 64;
const GATE_SIZE = 48;

const qubits = computed(() => Array.from({ length: props.numQubits }, (_, i) => i));
const steps = computed(() => Array.from({ length: maxSteps.value }, (_, i) => i));

const cnotGates = computed(() => props.gates.filter(g => g.type === 'CNOT'));

function getGateAt(qubit: number, step: number): Gate | undefined {
  return props.gates.find(g => g.qubit === qubit && g.step === step);
}

function getCnotControlAt(qubit: number, step: number): Gate | undefined {
  return props.gates.find(g => g.type === 'CNOT' && g.control === qubit && g.step === step);
}

function getCnotConnections(step: number) {
  return props.gates.filter(g => g.type === 'CNOT' && g.step === step);
}

function getControlY(qubit: number): number {
  return qubit * CELL_HEIGHT + CELL_HEIGHT / 2;
}

function getStepX(step: number): number {
  return step * CELL_WIDTH + CELL_WIDTH / 2;
}

function handleDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
}

function handleDragEnter(gateType: GateType) {
  draggingGate.value = gateType;
}

function handleDragLeave() {
  draggingGate.value = null;
}

function handleDrop(event: DragEvent, qubit: number, step: number) {
  event.preventDefault();
  const gateType = event.dataTransfer?.getData('gateType') as GateType;
  if (!gateType) return;

  if (gateType === 'CNOT') {
    if (pendingCnotControl.value === null) {
      pendingCnotControl.value = qubit;
    } else {
      if (pendingCnotControl.value !== qubit) {
        emit('addGate', {
          type: 'CNOT',
          qubit: qubit,
          control: pendingCnotControl.value,
          step: step,
        });
      }
      pendingCnotControl.value = null;
    }
  } else {
    if (!getGateAt(qubit, step)) {
      emit('addGate', {
        type: gateType,
        qubit: qubit,
        step: step,
      });
    }
  }
  draggingGate.value = null;
}

function handleGateClick(gate: Gate) {
  if (gate.id) {
    emit('removeGate', gate.id);
  }
}

function addStep() {
  maxSteps.value = Math.min(maxSteps.value + 5, 50);
}

function clearCircuit() {
  emit('clearCircuit');
  pendingCnotControl.value = null;
}

function cancelCnot() {
  pendingCnotControl.value = null;
}
</script>

<template>
  <div class="bg-slate-800/50 rounded-xl p-4 backdrop-blur-sm border border-slate-700">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-cyan-400 flex items-center gap-2">
        <span class="text-2xl">🔌</span>
        量子电路
      </h3>
      <div class="flex gap-2">
        <button
          v-if="pendingCnotControl !== null"
          @click="cancelCnot"
          class="px-3 py-1 text-xs bg-pink-500/20 text-pink-400 rounded-lg border border-pink-500/40 hover:bg-pink-500/30 transition"
        >
          取消 CNOT (控制: q{{ pendingCnotControl }})
        </button>
        <button
          @click="addStep"
          class="px-3 py-1 text-xs bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition"
        >
          + 添加步骤
        </button>
        <button
          @click="clearCircuit"
          class="px-3 py-1 text-xs bg-red-500/20 text-red-400 rounded-lg border border-red-500/40 hover:bg-red-500/30 transition"
        >
          清空电路
        </button>
      </div>
    </div>

    <div class="overflow-x-auto">
      <div class="relative min-w-max">
        <svg
          class="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
          :style="{
            width: `${maxSteps * CELL_WIDTH + 80}px`,
            height: `${numQubits * CELL_HEIGHT}px`,
            marginLeft: '64px'
          }"
        >
          <template v-for="step in steps" :key="'line-' + step">
            <line
              v-for="conn in getCnotConnections(step)"
              :key="'conn-' + step + '-' + conn.control + '-' + conn.qubit"
              :x1="getStepX(step)"
              :y1="getControlY(conn.control!)"
              :x2="getStepX(step)"
              :y2="getControlY(conn.qubit)"
              stroke="#ff79c6"
              stroke-width="2"
              stroke-dasharray="4,2"
            />
          </template>
        </svg>

        <div
          v-for="qubit in qubits"
          :key="qubit"
          class="flex items-center h-16 border-b border-slate-700 last:border-b-0"
        >
          <div class="w-16 flex-shrink-0 text-right pr-4 z-20">
            <span class="text-sm font-mono text-cyan-400">q{{ qubit }}</span>
            <span class="text-slate-500 text-xs ml-1">|0⟩</span>
          </div>

          <div class="flex items-center h-full">
            <div class="w-8 h-0.5 bg-slate-600"></div>
            <div
              v-for="step in steps"
              :key="step"
              class="relative flex items-center justify-center w-16 h-full z-20"
              @dragover="handleDragOver"
              @drop="handleDrop($event, qubit, step)"
              @dragenter="draggingGate && pendingCnotControl === null ? handleDragEnter($event.dataTransfer?.getData('gateType') as GateType) : null"
              @dragleave="handleDragLeave"
            >
              <div class="absolute inset-0 flex items-center">
                <div class="w-full h-0.5 bg-slate-600"></div>
              </div>

              <div
                v-if="getCnotControlAt(qubit, step)"
                class="absolute w-3 h-3 rounded-full bg-pink-500 z-30 cursor-pointer hover:scale-125 transition-transform shadow-lg shadow-pink-500/50"
                :title="'CNOT 控制位 (目标: q' + getCnotControlAt(qubit, step)?.qubit + ')'"
                @click="handleGateClick(getCnotControlAt(qubit, step)!)"
              ></div>

              <div
                v-if="getGateAt(qubit, step)"
                class="absolute z-40 w-12 h-12 rounded-lg flex items-center justify-center text-lg font-bold cursor-pointer hover:scale-110 transition-all shadow-lg"
                :style="{
                  backgroundColor: GATE_INFO[getGateAt(qubit, step)!.type].color + '30',
                  color: GATE_INFO[getGateAt(qubit, step)!.type].color,
                  border: `2px solid ${GATE_INFO[getGateAt(qubit, step)!.type].color}`,
                  boxShadow: `0 0 15px ${GATE_INFO[getGateAt(qubit, step)!.type].color}40`,
                }"
                :title="GATE_INFO[getGateAt(qubit, step)!.type].name + ' (点击删除)'"
                @click="handleGateClick(getGateAt(qubit, step)!)"
              >
                {{ getGateAt(qubit, step)!.type === 'CNOT' ? '⊕' : getGateAt(qubit, step)!.type }}
              </div>

              <div
                v-if="pendingCnotControl === qubit"
                class="absolute w-3 h-3 rounded-full bg-pink-500 animate-pulse z-50 shadow-lg shadow-pink-500/50"
              ></div>
            </div>
            <div class="w-8 h-0.5 bg-slate-600"></div>
          </div>
        </div>

        <div class="flex">
          <div class="w-16"></div>
          <div class="flex">
            <div class="w-8"></div>
            <div
              v-for="step in steps"
              :key="step"
              class="w-16 text-center text-xs text-slate-500 mt-2"
            >
              t{{ step }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
