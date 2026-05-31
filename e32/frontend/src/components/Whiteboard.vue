<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { fabric } from 'fabric'

const props = defineProps({
  socket: Object,
  roomId: String
})

const emit = defineEmits(['leave'])

const canvasRef = ref(null)
let canvas = null
const currentTool = ref('pen')
const currentColor = ref('#000000')
const brushSize = ref(5)
const isDrawing = ref(false)
const isReplaying = ref(false)
const userCount = ref(1)

const colors = ['#000000', '#e53e3e', '#38a169', '#3182ce', '#805ad5', '#d69e2e']

let isRemoteAction = false
let startPoint = null
let currentRect = null
let currentText = null

const shapeVersions = new Map()

const showConflictModal = ref(false)
const conflictInfo = ref(null)

const generateShapeId = () => {
  return 'shape_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

const getNextVersion = (shapeId) => {
  const current = shapeVersions.get(shapeId) || 0
  return current + 1
}

const updateShapeVersion = (shapeId, version) => {
  shapeVersions.set(shapeId, version)
}

const closeConflictModal = () => {
  showConflictModal.value = false
  conflictInfo.value = null
}

const CANVAS_STANDARD_WIDTH = 1920
const CANVAS_STANDARD_HEIGHT = 1080

const toStandardCoords = (clientX, clientY) => {
  if (!canvas) return { x: clientX, y: clientY }
  const scaleX = CANVAS_STANDARD_WIDTH / canvas.width
  const scaleY = CANVAS_STANDARD_HEIGHT / canvas.height
  return {
    x: clientX * scaleX,
    y: clientY * scaleY
  }
}

const fromStandardCoords = (standardX, standardY) => {
  if (!canvas) return { x: standardX, y: standardY }
  const scaleX = canvas.width / CANVAS_STANDARD_WIDTH
  const scaleY = canvas.height / CANVAS_STANDARD_HEIGHT
  return {
    x: standardX * scaleX,
    y: standardY * scaleY
  }
}

const convertPathToStandard = (path) => {
  return path.map(point => {
    if (point.length >= 2 && typeof point[1] === 'number' && typeof point[point.length - 1] === 'number') {
      const newPoint = [...point]
      for (let i = 1; i < newPoint.length; i += 2) {
        const standard = toStandardCoords(newPoint[i], newPoint[i + 1])
        newPoint[i] = standard.x
        newPoint[i + 1] = standard.y
      }
      return newPoint
    }
    return point
  })
}

const convertPathFromStandard = (path) => {
  return path.map(point => {
    if (point.length >= 2 && typeof point[1] === 'number' && typeof point[point.length - 1] === 'number') {
      const newPoint = [...point]
      for (let i = 1; i < newPoint.length; i += 2) {
        const client = fromStandardCoords(newPoint[i], newPoint[i + 1])
        newPoint[i] = client.x
        newPoint[i + 1] = client.y
      }
      return newPoint
    }
    return point
  })
}

const initCanvas = async () => {
  await nextTick()
  canvas = new fabric.Canvas(canvasRef.value, {
    width: window.innerWidth - 280,
    height: window.innerHeight - 20,
    backgroundColor: '#ffffff',
    isDrawingMode: false
  })

  canvas.on('mouse:down', handleMouseDown)
  canvas.on('mouse:move', handleMouseMove)
  canvas.on('mouse:up', handleMouseUp)

  window.addEventListener('resize', handleResize)
  loadHistory()
}

const handleResize = () => {
  if (canvas) {
    canvas.setWidth(window.innerWidth - 280)
    canvas.setHeight(window.innerHeight - 20)
  }
}

let currentShapeId = null

const handleMouseDown = (options) => {
  if (isReplaying.value) return
  
  const pointer = canvas.getPointer(options.e)
  isDrawing.value = true
  startPoint = pointer
  currentShapeId = generateShapeId()

  if (currentTool.value === 'pen') {
    canvas.isDrawingMode = true
    canvas.freeDrawingBrush.color = currentColor.value
    canvas.freeDrawingBrush.width = brushSize.value
  } else if (currentTool.value === 'rect') {
    currentRect = new fabric.Rect({
      left: pointer.x,
      top: pointer.y,
      width: 0,
      height: 0,
      fill: 'transparent',
      stroke: currentColor.value,
      strokeWidth: brushSize.value,
      selectable: false
    })
    canvas.add(currentRect)
  } else if (currentTool.value === 'text') {
    const standardPos = toStandardCoords(pointer.x, pointer.y)
    const text = new fabric.IText('输入文字', {
      left: pointer.x,
      top: pointer.y,
      fontFamily: 'Arial',
      fill: currentColor.value,
      fontSize: 24
    })
    canvas.add(text)
    canvas.setActiveObject(text)
    text.enterEditing()
    
    const version = getNextVersion(currentShapeId)
    updateShapeVersion(currentShapeId, version)
    
    sendAction('text', {
      text: '输入文字',
      x: standardPos.x,
      y: standardPos.y,
      color: currentColor.value,
      fontSize: 24,
      shapeId: currentShapeId,
      version: version
    })
  }
}

const handleMouseMove = (options) => {
  if (!isDrawing.value || isReplaying.value) return

  const pointer = canvas.getPointer(options.e)

  if (currentTool.value === 'rect' && currentRect) {
    currentRect.set({
      width: Math.abs(pointer.x - startPoint.x),
      height: Math.abs(pointer.y - startPoint.y),
      left: Math.min(startPoint.x, pointer.x),
      top: Math.min(startPoint.y, pointer.y)
    })
    canvas.renderAll()
  }
}

const handleMouseUp = (options) => {
  if (!isDrawing.value || isReplaying.value) return
  isDrawing.value = false

  if (currentTool.value === 'pen') {
    canvas.isDrawingMode = false
    const objects = canvas.getObjects()
    const lastObject = objects[objects.length - 1]
    if (lastObject && lastObject.type === 'path') {
      const standardPath = convertPathToStandard(lastObject.path)
      const version = getNextVersion(currentShapeId)
      updateShapeVersion(currentShapeId, version)
      sendAction('draw', {
        path: standardPath,
        stroke: lastObject.stroke,
        strokeWidth: lastObject.strokeWidth,
        shapeId: currentShapeId,
        version: version
      })
    }
  } else if (currentTool.value === 'rect' && currentRect) {
    const standardLeftTop = toStandardCoords(currentRect.left, currentRect.top)
    const standardWH = toStandardCoords(currentRect.width, currentRect.height)
    const version = getNextVersion(currentShapeId)
    updateShapeVersion(currentShapeId, version)
    sendAction('rect', {
      left: standardLeftTop.x,
      top: standardLeftTop.y,
      width: standardWH.x,
      height: standardWH.y,
      stroke: currentRect.stroke,
      strokeWidth: currentRect.strokeWidth,
      shapeId: currentShapeId,
      version: version
    })
    currentRect = null
  }
  currentShapeId = null
}

const sendAction = (type, data) => {
  if (isRemoteAction) return
  props.socket.emit('draw-action', {
    roomId: props.roomId,
    type,
    data
  })
}

const loadHistory = () => {
  props.socket.emit('get-actions', { roomId: props.roomId }, (response) => {
    response.actions.forEach(action => applyAction(action))
  })
}

const applyAction = (action) => {
  isRemoteAction = true
  if (action.type === 'draw') {
    const clientPath = convertPathFromStandard(action.data.path)
    const path = new fabric.Path(clientPath, {
      stroke: action.data.stroke,
      strokeWidth: action.data.strokeWidth,
      fill: 'transparent'
    })
    canvas.add(path)
    if (action.data.shapeId) {
      updateShapeVersion(action.data.shapeId, action.data.version || 1)
    }
  } else if (action.type === 'rect') {
    const clientLeftTop = fromStandardCoords(action.data.left, action.data.top)
    const clientWH = fromStandardCoords(action.data.width, action.data.height)
    const rect = new fabric.Rect({
      left: clientLeftTop.x,
      top: clientLeftTop.y,
      width: clientWH.x,
      height: clientWH.y,
      stroke: action.data.stroke,
      strokeWidth: action.data.strokeWidth,
      fill: 'transparent',
      selectable: false
    })
    canvas.add(rect)
    if (action.data.shapeId) {
      updateShapeVersion(action.data.shapeId, action.data.version || 1)
    }
  } else if (action.type === 'text') {
    const clientPos = fromStandardCoords(action.data.x, action.data.y)
    const text = new fabric.IText(action.data.text, {
      left: clientPos.x,
      top: clientPos.y,
      fontFamily: 'Arial',
      fill: action.data.color,
      fontSize: action.data.fontSize,
      selectable: false
    })
    canvas.add(text)
    if (action.data.shapeId) {
      updateShapeVersion(action.data.shapeId, action.data.version || 1)
    }
  } else if (action.type === 'clear') {
    canvas.clear()
    canvas.backgroundColor = '#ffffff'
    shapeVersions.clear()
  }
  canvas.renderAll()
  isRemoteAction = false
}

const clearCanvas = () => {
  canvas.clear()
  canvas.backgroundColor = '#ffffff'
  props.socket.emit('clear-canvas', { roomId: props.roomId })
}

const playHistory = async () => {
  isReplaying.value = true
  canvas.clear()
  canvas.backgroundColor = '#ffffff'

  props.socket.emit('get-recent-actions', { roomId: props.roomId }, async (response) => {
    for (const action of response.actions) {
      applyAction(action)
      await new Promise(r => setTimeout(r, 100))
    }
    isReplaying.value = false
  })
}

const setTool = (tool) => {
  currentTool.value = tool
  canvas.isDrawingMode = false
}

onMounted(() => {
  initCanvas()

  props.socket.on('draw-action', (action) => {
    applyAction(action)
  })

  props.socket.on('clear-canvas', () => {
    canvas.clear()
    canvas.backgroundColor = '#ffffff'
  })

  props.socket.on('user-joined', () => {
    userCount.value++
  })

  props.socket.on('user-left', () => {
    userCount.value--
  })

  props.socket.on('version-conflict', (data) => {
    conflictInfo.value = data
    showConflictModal.value = true
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  if (canvas) {
    canvas.dispose()
  }
})
</script>

<template>
  <div class="whiteboard-container">
    <div v-if="showConflictModal" class="conflict-modal-overlay" @click="closeConflictModal">
      <div class="conflict-modal" @click.stop>
        <div class="conflict-header">
          <span class="conflict-icon">⚠️</span>
          <h3>版本冲突</h3>
          <button class="close-btn" @click="closeConflictModal">×</button>
        </div>
        <div class="conflict-body">
          <p class="conflict-message">{{ conflictInfo?.message }}</p>
          <div class="conflict-details">
            <div class="detail-item">
              <span class="label">图形ID:</span>
              <span class="value">{{ conflictInfo?.shapeId }}</span>
            </div>
            <div class="detail-item">
              <span class="label">您的操作类型:</span>
              <span class="value">{{ conflictInfo?.loserAction?.type }}</span>
            </div>
            <div class="detail-item">
              <span class="label">时间:</span>
              <span class="value">{{ new Date(conflictInfo?.loserAction?.timestamp).toLocaleString() }}</span>
            </div>
          </div>
          <div class="conflict-tip">
            <p>💡 提示：您的修改已被其他用户覆盖，以服务器时间为准。</p>
          </div>
        </div>
        <div class="conflict-footer">
          <button class="confirm-btn" @click="closeConflictModal">知道了</button>
        </div>
      </div>
    </div>

    <div class="sidebar">
      <div class="room-info">
        <h3>房间号</h3>
        <div class="room-code">{{ roomId }}</div>
        <p class="user-count">{{ userCount }} 人在线</p>
      </div>

      <div class="tools">
        <h4>工具</h4>
        <div class="tool-buttons">
          <button 
            :class="['tool-btn', { active: currentTool === 'pen' }]"
            @click="setTool('pen')"
            title="画笔"
          >
            ✏️
          </button>
          <button 
            :class="['tool-btn', { active: currentTool === 'rect' }]"
            @click="setTool('rect')"
            title="矩形"
          >
            ⬜
          </button>
          <button 
            :class="['tool-btn', { active: currentTool === 'text' }]"
            @click="setTool('text')"
            title="文字"
          >
            T
          </button>
        </div>
      </div>

      <div class="colors">
        <h4>颜色</h4>
        <div class="color-picker">
          <button 
            v-for="color in colors" 
            :key="color"
            :class="['color-btn', { active: currentColor === color }]"
            :style="{ backgroundColor: color }"
            @click="currentColor = color"
          />
        </div>
      </div>

      <div class="brush-size">
        <h4>画笔大小: {{ brushSize }}</h4>
        <input 
          type="range" 
          min="1" 
          max="20" 
          v-model="brushSize"
        />
      </div>

      <div class="actions">
        <button class="action-btn replay" @click="playHistory" :disabled="isReplaying">
          {{ isReplaying ? '回放中...' : '回放5分钟' }}
        </button>
        <button class="action-btn clear" @click="clearCanvas">
          清空画布
        </button>
        <button class="action-btn leave" @click="emit('leave')">
          离开房间
        </button>
      </div>
    </div>

    <div class="canvas-container">
      <canvas ref="canvasRef"></canvas>
    </div>
  </div>
</template>

<style scoped>
.whiteboard-container {
  display: flex;
  width: 100%;
  height: 100%;
  position: relative;
}

.conflict-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.conflict-modal {
  background: white;
  border-radius: 12px;
  width: 450px;
  max-width: 90%;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.conflict-header {
  background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.conflict-icon {
  font-size: 28px;
}

.conflict-header h3 {
  margin: 0;
  color: white;
  font-size: 20px;
  flex: 1;
}

.close-btn {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: white;
  font-size: 24px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.3s;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.conflict-body {
  padding: 24px;
}

.conflict-message {
  font-size: 16px;
  color: #333;
  margin-bottom: 20px;
  font-weight: 500;
}

.conflict-details {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #e0e0e0;
}

.detail-item:last-child {
  border-bottom: none;
}

.detail-item .label {
  color: #666;
  font-size: 14px;
}

.detail-item .value {
  color: #333;
  font-size: 14px;
  font-weight: 500;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conflict-tip {
  background: #fff3e0;
  border-left: 4px solid #ff9800;
  padding: 12px 16px;
  border-radius: 4px;
}

.conflict-tip p {
  margin: 0;
  color: #e65100;
  font-size: 14px;
}

.conflict-footer {
  padding: 16px 24px;
  border-top: 1px solid #e0e0e0;
  display: flex;
  justify-content: flex-end;
}

.confirm-btn {
  background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
  color: white;
  border: none;
  padding: 10px 24px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.confirm-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(255, 152, 0, 0.3);
}

.sidebar {
  width: 260px;
  background: #1a1a2e;
  color: white;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.room-info {
  text-align: center;
  padding-bottom: 20px;
  border-bottom: 1px solid #333;
}

.room-info h3 {
  font-size: 14px;
  color: #aaa;
  margin-bottom: 8px;
}

.room-code {
  font-size: 32px;
  font-weight: bold;
  letter-spacing: 4px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.user-count {
  color: #aaa;
  font-size: 14px;
  margin-top: 8px;
}

.tools h4,
.colors h4,
.brush-size h4 {
  font-size: 14px;
  margin-bottom: 12px;
  color: #aaa;
}

.tool-buttons {
  display: flex;
  gap: 8px;
}

.tool-btn {
  width: 48px;
  height: 48px;
  border: 2px solid #333;
  background: #252540;
  border-radius: 8px;
  font-size: 20px;
  cursor: pointer;
  transition: all 0.3s;
  color: white;
}

.tool-btn:hover {
  border-color: #667eea;
}

.tool-btn.active {
  border-color: #667eea;
  background: #667eea;
}

.color-picker {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.color-btn {
  width: 32px;
  height: 32px;
  border: 3px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.3s;
}

.color-btn:hover {
  transform: scale(1.1);
}

.color-btn.active {
  border-color: white;
}

.brush-size input {
  width: 100%;
}

.actions {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-btn {
  padding: 12px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.action-btn.replay {
  background: #38a169;
  color: white;
}

.action-btn.replay:hover:not(:disabled) {
  background: #2f855a;
}

.action-btn.replay:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.action-btn.clear {
  background: #e53e3e;
  color: white;
}

.action-btn.clear:hover {
  background: #c53030;
}

.action-btn.leave {
  background: #333;
  color: white;
}

.action-btn.leave:hover {
  background: #444;
}

.canvas-container {
  flex: 1;
  background: #f0f0f0;
  padding: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

canvas {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}
</style>
