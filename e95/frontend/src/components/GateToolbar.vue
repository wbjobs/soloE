<script setup lang="ts">
import { GATE_INFO, type GateType } from '@/types/quantum';

const emit = defineEmits<{
  (e: 'dragStart', gateType: GateType): void;
}>();

const gates = Object.values(GATE_INFO);

function handleDragStart(event: DragEvent, gateType: GateType) {
  if (event.dataTransfer) {
    event.dataTransfer.setData('gateType', gateType);
    event.dataTransfer.effectAllowed = 'copy';
  }
  emit('dragStart', gateType);
}
</script>

<template>
  <div class="bg-slate-800/50 rounded-xl p-4 backdrop-blur-sm border border-slate-700">
    <h3 class="text-lg font-semibold text-cyan-400 mb-4 flex items-center gap-2">
      <span class="text-2xl">⚛️</span>
      量子门工具箱
    </h3>
    <div class="grid grid-cols-2 gap-3">
      <div
        v-for="gate in gates"
        :key="gate.type"
        draggable="true"
        @dragstart="handleDragStart($event, gate.type)"
        class="group cursor-grab active:cursor-grabbing rounded-lg p-3 border transition-all duration-200 hover:scale-105 hover:shadow-lg"
        :style="{
          backgroundColor: gate.color + '15',
          borderColor: gate.color + '40',
        }"
      >
        <div
          class="w-12 h-12 mx-auto mb-2 rounded-lg flex items-center justify-center text-xl font-bold transition-transform group-hover:scale-110"
          :style="{
            backgroundColor: gate.color + '30',
            color: gate.color,
            textShadow: `0 0 10px ${gate.color}80`,
          }"
        >
          {{ gate.type === 'CNOT' ? '⊕' : gate.type }}
        </div>
        <div class="text-center">
          <div class="text-sm font-medium text-white">{{ gate.name }}</div>
          <div class="text-xs text-slate-400 mt-1">{{ gate.description }}</div>
        </div>
      </div>
    </div>
    <div class="mt-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
      <p class="text-xs text-slate-400">
        💡 提示：拖拽量子门到右侧电路画布上，CNOT 门需要先拖到控制位，再选择目标位
      </p>
    </div>
  </div>
</template>
