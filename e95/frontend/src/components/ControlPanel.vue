<script setup lang="ts">
import { ref, computed } from 'vue';
import type { MeasureResult } from '@/types/quantum';

const props = defineProps<{
  numQubits: number;
  isRunning: boolean;
  lastMeasureResult: MeasureResult | null;
}>();

const emit = defineEmits<{
  (e: 'update:numQubits', value: number): void;
  (e: 'run'): void;
  (e: 'reset'): void;
  (e: 'measure', qubit: number): void;
}>();

const selectedQubit = ref(0);
const qubitOptions = computed(() => Array.from({ length: props.numQubits }, (_, i) => i));

function handleNumQubitsChange(event: Event) {
  const target = event.target as HTMLInputElement;
  emit('update:numQubits', parseInt(target.value));
}

function handleMeasure() {
  emit('measure', selectedQubit.value);
}
</script>

<template>
  <div class="bg-slate-800/50 rounded-xl p-4 backdrop-blur-sm border border-slate-700">
    <h3 class="text-lg font-semibold text-cyan-400 mb-4 flex items-center gap-2">
      <span class="text-2xl">🎛️</span>
      控制面板
    </h3>

    <div class="space-y-4">
      <div>
        <label class="block text-sm text-slate-300 mb-2">
          量子比特数量: <span class="text-cyan-400 font-mono">{{ numQubits }}</span>
        </label>
        <input
          type="range"
          :value="numQubits"
          @input="handleNumQubitsChange"
          min="1"
          max="12"
          step="1"
          class="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
        />
        <div class="flex justify-between text-xs text-slate-500 mt-1">
          <span>1</span>
          <span>6</span>
          <span>12</span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <button
          @click="emit('run')"
          :disabled="isRunning"
          class="px-4 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-lg hover:from-cyan-400 hover:to-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/20"
        >
          {{ isRunning ? '运行中...' : '▶ 运行电路' }}
        </button>
        <button
          @click="emit('reset')"
          class="px-4 py-3 bg-slate-700 text-slate-200 font-semibold rounded-lg hover:bg-slate-600 transition-all"
        >
          ↺ 重置
        </button>
      </div>

      <div class="border-t border-slate-700 pt-4">
        <h4 class="text-sm font-medium text-slate-300 mb-3">量子测量</h4>
        <div class="flex gap-2">
          <select
            v-model="selectedQubit"
            class="flex-1 px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:border-cyan-400 focus:outline-none"
          >
            <option v-for="q in qubitOptions" :key="q" :value="q">
              q{{ q }}
            </option>
          </select>
          <button
            @click="handleMeasure"
            :disabled="isRunning"
            class="px-4 py-2 bg-purple-500 text-white font-medium rounded-lg hover:bg-purple-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            测量
          </button>
        </div>
      </div>

      <div
        v-if="lastMeasureResult"
        class="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3"
      >
        <div class="text-sm text-purple-300 mb-1">最近测量结果</div>
        <div class="flex items-center gap-3">
          <div class="text-2xl font-mono font-bold text-purple-400">
            |{{ lastMeasureResult.result }}⟩
          </div>
          <div class="text-xs text-slate-400">
            量子比特 q{{ lastMeasureResult.qubit }}
          </div>
        </div>
      </div>

      <div class="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
        <h4 class="text-sm font-medium text-slate-300 mb-2">快捷示例</h4>
        <div class="text-xs text-slate-400 space-y-1">
          <p>• <span class="text-cyan-400">H</span> 创建叠加态</p>
          <p>• <span class="text-cyan-400">H + CNOT</span> 创建 Bell 纠缠态</p>
          <p>• <span class="text-cyan-400">X</span> 翻转量子比特</p>
          <p>• <span class="text-cyan-400">S/T</span> 添加相位</p>
        </div>
      </div>
    </div>
  </div>
</template>
