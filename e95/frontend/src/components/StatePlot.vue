<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue';
import Plotly from 'plotly.js-dist-min';
import type { Data, Layout, Config } from 'plotly.js-dist-min';
import type { StateVector } from '@/types/quantum';

const props = defineProps<{
  stateVector: StateVector | null;
}>();

const plotContainer = ref<HTMLDivElement | null>(null);

function renderPlot() {
  if (!plotContainer.value || !props.stateVector) return;

  const { basisStates, state, probabilities } = props.stateVector;

  const realParts = state.real;
  const imagParts = state.imag;

  const traceReal: Data = {
    x: basisStates,
    y: realParts,
    type: 'bar',
    name: '实部',
    marker: {
      color: '#64ffda',
      opacity: 0.8,
    },
  };

  const traceImag: Data = {
    x: basisStates,
    y: imagParts,
    type: 'bar',
    name: '虚部',
    marker: {
      color: '#ffb86c',
      opacity: 0.8,
    },
  };

  const traceProb: Data = {
    x: basisStates,
    y: probabilities,
    type: 'bar',
    name: '概率',
    marker: {
      color: '#bd93f9',
      opacity: 0.6,
    },
  };

  const data: Data[] = [traceReal, traceImag, traceProb];

  const layout: Partial<Layout> = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      color: '#e2e8f0',
      family: 'JetBrains Mono, monospace',
    },
    title: {
      text: '量子态矢量',
      font: {
        color: '#64ffda',
        size: 16,
      },
    },
    xaxis: {
      title: '基态',
      gridcolor: 'rgba(148, 163, 184, 0.1)',
      tickangle: -45,
    },
    yaxis: {
      title: '振幅',
      gridcolor: 'rgba(148, 163, 184, 0.1)',
      zerolinecolor: 'rgba(148, 163, 184, 0.3)',
    },
    legend: {
      x: 1,
      y: 1,
      bgcolor: 'rgba(30, 41, 59, 0.8)',
      bordercolor: 'rgba(148, 163, 184, 0.2)',
      borderwidth: 1,
    },
    margin: {
      l: 60,
      r: 20,
      t: 40,
      b: 80,
    },
    barmode: 'group',
    bargap: 0.15,
    bargroupgap: 0.1,
  };

  const config: Partial<Config> = {
    responsive: true,
    displayModeBar: false,
  };

  Plotly.newPlot(plotContainer.value, data, layout, config);
}

watch(
  () => props.stateVector,
  () => {
    nextTick(() => renderPlot());
  },
  { deep: true }
);

onMounted(() => {
  renderPlot();
});
</script>

<template>
  <div class="bg-slate-800/50 rounded-xl p-4 backdrop-blur-sm border border-slate-700">
    <h3 class="text-lg font-semibold text-cyan-400 mb-4 flex items-center gap-2">
      <span class="text-2xl">📊</span>
      态矢量可视化
    </h3>
    <div ref="plotContainer" class="w-full h-80"></div>
    <div v-if="!stateVector" class="flex items-center justify-center h-80 text-slate-500">
      运行电路后显示态矢量
    </div>
  </div>
</template>
