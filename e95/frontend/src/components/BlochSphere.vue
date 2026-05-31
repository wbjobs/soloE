<script setup lang="ts">
import { ref, watch, onMounted, nextTick, computed } from 'vue';
import Plotly from 'plotly.js-dist-min';
import type { Data, Layout, Config } from 'plotly.js-dist-min';
import type { BlochCoordinates } from '@/types/quantum';

const props = defineProps<{
  coordinates: BlochCoordinates | null;
  loading?: boolean;
}>();

const plotContainer = ref<HTMLDivElement | null>(null);

const hasValidCoords = computed(() => {
  if (!props.coordinates) return false;
  const { x, y, z } = props.coordinates;
  return !isNaN(x) && !isNaN(y) && !isNaN(z) && isFinite(x) && isFinite(y) && isFinite(z);
});

function renderPlot() {
  if (!plotContainer.value || !hasValidCoords.value || !props.coordinates) return;

  const { x, y, z } = props.coordinates;

  const sphereData: Data = {
    type: 'surface',
    x: [],
    y: [],
    z: [],
    opacity: 0.3,
    showscale: false,
    colorscale: [[0, '#1e293b'], [1, '#334155']],
    hoverinfo: 'none',
  };

  const theta = [];
  const phi = [];
  for (let i = 0; i <= 30; i++) {
    theta.push((i * Math.PI) / 30);
  }
  for (let j = 0; j <= 60; j++) {
    phi.push((j * 2 * Math.PI) / 60);
  }

  const sphereX: number[][] = [];
  const sphereY: number[][] = [];
  const sphereZ: number[][] = [];

  for (let i = 0; i < theta.length; i++) {
    const rowX: number[] = [];
    const rowY: number[] = [];
    const rowZ: number[] = [];
    for (let j = 0; j < phi.length; j++) {
      rowX.push(Math.sin(theta[i]) * Math.cos(phi[j]));
      rowY.push(Math.sin(theta[i]) * Math.sin(phi[j]));
      rowZ.push(Math.cos(theta[i]));
    }
    sphereX.push(rowX);
    sphereY.push(rowY);
    sphereZ.push(rowZ);
  }

  sphereData.x = sphereX as any;
  sphereData.y = sphereY as any;
  sphereData.z = sphereZ as any;

  const axisLines: Data[] = [];

  const xAxis: Data = {
    type: 'scatter3d',
    mode: 'lines',
    x: [-1.1, 1.1],
    y: [0, 0],
    z: [0, 0],
    line: { color: '#64ffda', width: 2 },
    showlegend: false,
    hoverinfo: 'none',
  };
  axisLines.push(xAxis);

  const yAxis: Data = {
    type: 'scatter3d',
    mode: 'lines',
    x: [0, 0],
    y: [-1.1, 1.1],
    z: [0, 0],
    line: { color: '#ff5555', width: 2 },
    showlegend: false,
    hoverinfo: 'none',
  };
  axisLines.push(yAxis);

  const zAxis: Data = {
    type: 'scatter3d',
    mode: 'lines',
    x: [0, 0],
    y: [0, 0],
    z: [-1.1, 1.1],
    line: { color: '#bd93f9', width: 2 },
    showlegend: false,
    hoverinfo: 'none',
  };
  axisLines.push(zAxis);

  const stateVector: Data = {
    type: 'scatter3d',
    mode: 'lines+markers',
    x: [0, x],
    y: [0, y],
    z: [0, z],
    line: {
      color: '#f1fa8c',
      width: 4,
    },
    marker: {
      size: 8,
      color: '#f1fa8c',
      line: {
        color: '#ffffff',
        width: 2,
      },
    },
    showlegend: false,
  };

  const equator: Data = {
    type: 'scatter3d',
    mode: 'lines',
    x: [],
    y: [],
    z: [],
    line: { color: '#475569', width: 1 },
    showlegend: false,
    hoverinfo: 'none',
  };

  for (let i = 0; i <= 60; i++) {
    const angle = (i * 2 * Math.PI) / 60;
    (equator.x as number[]).push(Math.cos(angle));
    (equator.y as number[]).push(Math.sin(angle));
    (equator.z as number[]).push(0);
  }

  const data: Data[] = [sphereData, xAxis, yAxis, zAxis, equator, stateVector];

  const annotations = [
    {
      x: 1.2, y: 0, z: 0,
      text: 'X',
      showarrow: false,
      font: { color: '#64ffda', size: 12, family: 'JetBrains Mono' },
    },
    {
      x: 0, y: 1.2, z: 0,
      text: 'Y',
      showarrow: false,
      font: { color: '#ff5555', size: 12, family: 'JetBrains Mono' },
    },
    {
      x: 0, y: 0, z: 1.2,
      text: '|0⟩',
      showarrow: false,
      font: { color: '#bd93f9', size: 12, family: 'JetBrains Mono' },
    },
    {
      x: 0, y: 0, z: -1.2,
      text: '|1⟩',
      showarrow: false,
      font: { color: '#bd93f9', size: 12, family: 'JetBrains Mono' },
    },
  ];

  const layout: Partial<Layout> = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    scene: {
      xaxis: {
        showgrid: false,
        zeroline: false,
        showticklabels: false,
        title: '',
        range: [-1.5, 1.5],
      },
      yaxis: {
        showgrid: false,
        zeroline: false,
        showticklabels: false,
        title: '',
        range: [-1.5, 1.5],
      },
      zaxis: {
        showgrid: false,
        zeroline: false,
        showticklabels: false,
        title: '',
        range: [-1.5, 1.5],
      },
      camera: {
        eye: { x: 1.5, y: 1.5, z: 1.5 },
      },
      annotations: annotations as any,
    },
    margin: {
      l: 0,
      r: 0,
      t: 0,
      b: 0,
    },
    showlegend: false,
  };

  const config: Partial<Config> = {
    responsive: true,
    displayModeBar: false,
  };

  Plotly.react(plotContainer.value, data, layout, config);
}

watch(
  () => props.coordinates,
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
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-sm font-semibold text-purple-400 flex items-center gap-2">
        <span class="text-lg">🌐</span>
        布洛赫球 (单量子比特)
      </h3>
    </div>

    <div
      v-if="loading"
      class="flex items-center justify-center h-64 text-slate-500 text-sm"
    >
      <span class="animate-pulse">加载中...</span>
    </div>

    <div v-else-if="hasValidCoords && coordinates">
      <div ref="plotContainer" class="w-full h-64"></div>
      <div class="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div class="bg-slate-700/50 rounded-lg py-2">
          <div class="text-cyan-400 font-mono">x</div>
          <div class="text-white">{{ coordinates.x.toFixed(4) }}</div>
        </div>
        <div class="bg-slate-700/50 rounded-lg py-2">
          <div class="text-red-400 font-mono">y</div>
          <div class="text-white">{{ coordinates.y.toFixed(4) }}</div>
        </div>
        <div class="bg-slate-700/50 rounded-lg py-2">
          <div class="text-purple-400 font-mono">z</div>
          <div class="text-white">{{ coordinates.z.toFixed(4) }}</div>
        </div>
      </div>
    </div>

    <div
      v-else
      class="flex items-center justify-center h-64 text-slate-500 text-sm"
    >
      将量子比特数设为 1 以显示布洛赫球
    </div>
  </div>
</template>
