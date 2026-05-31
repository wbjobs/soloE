<template>
  <div class="app-container">
    <div class="sidebar">
      <h2>🏠 室内场景编辑器</h2>
      
      <div class="section">
        <h3>房间设置</h3>
        <div class="form-group">
          <label>房间形状</label>
          <select v-model="roomConfig.shape">
            <option value="rectangle">矩形房间</option>
            <option value="L-shape">L型房间</option>
          </select>
        </div>
        <div class="form-group">
          <label>宽度 (米)</label>
          <input type="number" v-model.number="roomConfig.width" min="4" max="15" step="0.5">
        </div>
        <div class="form-group">
          <label>深度 (米)</label>
          <input type="number" v-model.number="roomConfig.depth" min="4" max="15" step="0.5">
        </div>
        <button class="btn btn-primary" @click="createRoom">生成房间</button>
      </div>

      <div class="section">
        <h3>家具选择</h3>
        <div class="checkbox-group">
          <div 
            v-for="furniture in availableFurniture" 
            :key="furniture.type"
            class="checkbox-item"
            :class="{ selected: selectedFurniture.includes(furniture.type) }"
            @click="toggleFurniture(furniture.type)"
          >
            {{ furniture.name }}
          </div>
        </div>
      </div>

      <div class="section">
        <h3>布局优化</h3>
        <p class="hint">已选家具: {{ selectedFurniture.length }} 件</p>
        <button 
          class="btn btn-primary" 
          @click="optimizeLayout"
          :disabled="!roomCreated || selectedFurniture.length === 0"
        >
          智能布局
        </button>
        <button 
          class="btn btn-secondary" 
          @click="clearFurniture"
          style="margin-top: 8px"
          :disabled="!roomCreated"
        >
          清空家具
        </button>
      </div>

      <div class="section">
        <h3>光照烘焙</h3>
        <p class="hint">
          状态: {{ lightmapBaked ? '已烘焙 ✓' : '未烘焙' }}
        </p>
        <p class="hint" v-if="lightmapBaked">
          静态物体: {{ staticFurnitureCount }} 件
        </p>
        <button 
          class="btn btn-primary" 
          @click="bakeLightmap"
          :disabled="!roomCreated || lightmapBaked"
          style="background: linear-gradient(90deg, #ff6b6b, #feca57)"
        >
          🔥 烘焙光照贴图
        </button>
        <button 
          class="btn btn-secondary" 
          @click="clearLightmap"
          style="margin-top: 8px"
          :disabled="!lightmapBaked"
        >
          清除烘焙
        </button>
        <p class="hint" style="margin-top: 10px; font-size: 11px;">
          • 烘焙后阴影性能提升50%<br>
          • 烘焙后家具可继续拖拽<br>
          • 512x512分辨率光照贴图
        </p>
      </div>

      <div class="section">
        <h3>操作说明</h3>
        <p class="hint">
          • 鼠标左键拖拽: 旋转视角<br>
          • 鼠标右键拖拽: 平移视角<br>
          • 滚轮: 缩放<br>
          • 点击家具拖拽: 微调位置
        </p>
      </div>
    </div>

    <div class="viewport">
      <div id="canvas-container" ref="canvasContainer"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import SceneManager from './utils/SceneManager'
import LayoutEngine from './utils/LayoutEngine'

const canvasContainer = ref(null)
let sceneManager = null
let layoutEngine = null

const roomCreated = ref(false)
const lightmapBaked = ref(false)

const roomConfig = ref({
  shape: 'rectangle',
  width: 8,
  depth: 6
})

const availableFurniture = [
  { type: 'sofa', name: '沙发' },
  { type: 'bed', name: '床' },
  { type: 'table', name: '桌子' },
  { type: 'chair', name: '椅子' },
  { type: 'cabinet', name: '柜子' }
]

const selectedFurniture = ref(['sofa', 'table', 'chair'])

const staticFurnitureCount = computed(() => {
  if (!sceneManager) return 0
  return sceneManager.staticFurniture.length + sceneManager.walls.length + (sceneManager.floor ? 1 : 0)
})

function toggleFurniture(type) {
  const index = selectedFurniture.value.indexOf(type)
  if (index > -1) {
    selectedFurniture.value.splice(index, 1)
  } else {
    selectedFurniture.value.push(type)
  }
}

function createRoom() {
  if (!sceneManager) return
  
  lightmapBaked.value = false
  sceneManager.createRoom({
    shape: roomConfig.value.shape,
    width: roomConfig.value.width,
    depth: roomConfig.value.depth,
    height: 2.8
  })
  
  layoutEngine = new LayoutEngine(sceneManager)
  roomCreated.value = true
}

function optimizeLayout() {
  if (!layoutEngine || selectedFurniture.value.length === 0) return
  
  lightmapBaked.value = false
  sceneManager.clearFurniture()
  
  const layout = layoutEngine.calculateLayout(
    selectedFurniture.value,
    roomConfig.value
  )
  
  layout.forEach(furniture => {
    sceneManager.addFurniture(
      furniture.type,
      { x: furniture.x, z: furniture.z },
      furniture.rotation
    )
  })
}

function clearFurniture() {
  if (sceneManager) {
    lightmapBaked.value = false
    sceneManager.clearFurniture()
  }
}

function bakeLightmap() {
  if (!sceneManager || lightmapBaked.value) return
  
  sceneManager.markAllFurnitureAsStatic()
  
  setTimeout(() => {
    sceneManager.bakeLightmap()
    lightmapBaked.value = true
  }, 100)
}

function clearLightmap() {
  if (!sceneManager) return
  sceneManager.clearLightmap()
  lightmapBaked.value = false
}

onMounted(() => {
  if (canvasContainer.value) {
    sceneManager = new SceneManager(canvasContainer.value)
  }
})

onUnmounted(() => {
  if (sceneManager) {
    sceneManager.destroy()
  }
})
</script>
