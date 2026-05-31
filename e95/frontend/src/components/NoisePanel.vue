<script setup lang="ts">
import { ref, watch } from 'vue';
import type { NoiseConfig } from '@/types/quantum';

const props = defineProps<{
  modelValue: NoiseConfig;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: NoiseConfig): void;
}>();

const localConfig = ref<NoiseConfig>({
  enabled: props.modelValue.enabled,
  bitFlipProbability: props.modelValue.bitFlipProbability,
  phaseDampingGamma: props.modelValue.phaseDampingGamma,
});

watch(
  () => props.modelValue,
  (newVal) => {
    localConfig.value = { ...newVal };
  },
  { deep: true }
);

function updateConfig() {
  emit('update:modelValue', { ...localConfig.value });
}

function toggleNoise() {
  localConfig.value.enabled = !localConfig.value.enabled;
  updateConfig();
}
</script>

<template>
  <div class="bg-slate-800/50 rounded-xl p-4 backdrop-blur-sm border border-slate-700">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-semibold text-orange-400 flex items-center gap-2">
        <span class="text-lg">⚡</span>
        噪声模拟
      </h3>
      <button
        @click="toggleNoise"
        class="relative w-12 h-6 rounded-full transition-colors"
        :class="localConfig.enabled ? 'bg-orange-500' : 'bg-slate-600'"
      >
        <span
          class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-md"
          :class="localConfig.enabled ? 'translate-x-6' : 'translate-x-0'"
        ></span>
      </button>
    </div>

    <div v-if="localConfig.enabled" class="space-y-4">
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span class="text-slate-400">比特翻转概率</span>
          <span class="text-orange-400 font-mono">{{ (localConfig.bitFlipProbability * 100).toFixed(1) }}%</span>
        </div>
        <input
          v-model.number="localConfig.bitFlipProbability"
          @change="updateConfig"
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          class="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
        />
        <p class="text-xs text-slate-500 mt-1">每个门后以概率 p 应用 X 门</p>
      </div>

      <div>
        <div class="flex justify-between text-xs mb-1">
          <span class="text-slate-400">相位阻尼 γ</span>
          <span class="text-orange-400 font-mono">{{ (localConfig.phaseDampingGamma * 100).toFixed(1) }}%</span>
        </div>
        <input
          v-model.number="localConfig.phaseDampingGamma"
          @change="updateConfig"
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          class="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
        />
        <p class="text-xs text-slate-500 mt-1">每个门后以概率 γ 引入相位阻尼</p>
      </div>
    </div>

    <div v-else class="text-center py-4 text-slate-500 text-sm">
      噪声模拟已禁用
    </div>
  </div>
</template>
