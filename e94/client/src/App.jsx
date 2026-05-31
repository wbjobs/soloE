import { useState, useEffect, useCallback, useRef } from 'react'
import VoxelEditor from './components/VoxelEditor.jsx'
import { exportToVox } from './utils/voxExporter.js'
import { exportToSTL } from './utils/stlExporter.js'
import { generateTerrain } from './utils/terrainGenerator.js'
import { COLORS, getRandomPlayerColor } from './utils/colorUtils.js'

const CHUNK_SIZE = 16
const VOXEL_COUNT = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE
const API_BASE = 'http://localhost:3001/api'

function getDefaultVoxelData() {
  const data = new Uint8Array(VOXEL_COUNT)
  return btoa(String.fromCharCode.apply(null, data))
}

function setVoxelInData(dataStr, x, y, z, value) {
  const binaryString = atob(dataStr)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE
  bytes[index] = value
  return btoa(String.fromCharCode.apply(null, bytes))
}

function getTimestamp() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000)
}

export default function App() {
  const [user, setUser] = useState(null)
  const [showLogin, setShowLogin] = useState(true)
  const [loginName, setLoginName] = useState('')
  const [loginColor, setLoginColor] = useState(getRandomPlayerColor())

  const [works, setWorks] = useState([])
  const [currentWork, setCurrentWork] = useState(null)
  const [voxelData, setVoxelData] = useState(getDefaultVoxelData())
  const [currentTool, setCurrentTool] = useState('add')
  const [currentColorIndex, setCurrentColorIndex] = useState(1)
  const [sidebarTab, setSidebarTab] = useState('works')

  const [players, setPlayers] = useState([])
  const wsRef = useRef(null)
  const currentWorkIdRef = useRef(null)
  const localTimestampsRef = useRef(new BigUint64Array(VOXEL_COUNT))

  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveTitle, setSaveTitle] = useState('')
  const [saveDescription, setSaveDescription] = useState('')

  const [lightingMode, setLightingMode] = useState('standard')
  const [showTerrainModal, setShowTerrainModal] = useState(false)
  const [terrainSeed, setTerrainSeed] = useState('')
  const [terrainScale, setTerrainScale] = useState(3)
  const [terrainHeight, setTerrainHeight] = useState(8)
  const [terrainWater, setTerrainWater] = useState(4)
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false)

  useEffect(() => {
    if (!user) return
    fetchWorks()
  }, [user])

  const fetchWorks = async () => {
    try {
      const res = await fetch(`${API_BASE}/works`)
      const data = await res.json()
      setWorks(data)
    } catch (e) {
      console.error('Failed to fetch works:', e)
    }
  }

  const handleLogin = async () => {
    if (!loginName.trim()) return
    try {
      const res = await fetch(`${API_BASE}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: loginName.trim(), color: loginColor })
      })
      const userData = await res.json()
      setUser(userData)
      setShowLogin(false)
    } catch (e) {
      console.error('Login failed:', e)
    }
  }

  const connectWebSocket = useCallback((workId) => {
    if (wsRef.current) {
      wsRef.current.close()
    }
    currentWorkIdRef.current = workId

    const wsUrl = `ws://localhost:3001/ws?workId=${workId}&userId=${user.id}&userName=${encodeURIComponent(user.name)}&userColor=${user.color}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === 'init') {
        setVoxelData(data.voxelData)
        setPlayers(data.players.filter(p => p.id !== user.id))
        localTimestampsRef.current = new BigUint64Array(VOXEL_COUNT)
      } else if (data.type === 'voxelUpdate') {
        if (data.userId === user.id) return

        const localTs = localTimestampsRef.current
        const index = data.x + data.y * CHUNK_SIZE + data.z * CHUNK_SIZE * CHUNK_SIZE
        const remoteTs = BigInt(data.timestamp || 0)

        if (remoteTs > localTs[index]) {
          localTs[index] = remoteTs
          setVoxelData(prev => setVoxelInData(prev, data.x, data.y, data.z, data.value))
        }
      } else if (data.type === 'playerJoin') {
        setPlayers(prev => [...prev.filter(p => p.id !== data.player.id), data.player])
      } else if (data.type === 'playerLeave') {
        setPlayers(prev => prev.filter(p => p.id !== data.playerId))
      } else if (data.type === 'playerMove') {
        setPlayers(prev => prev.map(p =>
          p.id === data.playerId ? { ...p, position: data.position } : p
        ))
      }
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      setPlayers([])
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }
  }, [user])

  const handleVoxelChange = useCallback((x, y, z, value) => {
    const timestamp = getTimestamp()
    const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE

    localTimestampsRef.current[index] = BigInt(timestamp)
    setVoxelData(prev => setVoxelInData(prev, x, y, z, value))

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'setVoxel',
        x, y, z, value, timestamp
      }))
    }
  }, [])

  const handleNewWork = () => {
    const tempId = 'temp_' + Date.now()
    setCurrentWork({ id: tempId, title: '未保存作品', isNew: true })
    setVoxelData(getDefaultVoxelData())
    localTimestampsRef.current = new BigUint64Array(VOXEL_COUNT)
    connectWebSocket(tempId)
  }

  const handleLoadWork = (work) => {
    setCurrentWork(work)
    setVoxelData(work.voxelData)
    localTimestampsRef.current = new BigUint64Array(VOXEL_COUNT)
    connectWebSocket(work.id)
  }

  const handleThumbnailUpload = async (workId) => {
    const canvas = document.querySelector('#three-canvas')
    if (!canvas) return null

    try {
      setIsUploadingThumbnail(true)
      const dataUrl = canvas.toDataURL('image/png')
      const response = await fetch(dataUrl)
      const blob = await response.blob()

      const formData = new FormData()
      formData.append('file', blob, 'thumbnail.png')

      const res = await fetch(`${API_BASE}/works/${workId}/thumbnail`, {
        method: 'POST',
        body: formData
      })

      const result = await res.json()
      if (result.success) {
        return result.thumbnail
      }
      return null
    } catch (e) {
      console.error('Thumbnail upload failed:', e)
      return null
    } finally {
      setIsUploadingThumbnail(false)
    }
  }

  const handleSave = async () => {
    if (!saveTitle.trim()) return

    try {
      const workData = {
        title: saveTitle.trim(),
        description: saveDescription.trim(),
        voxelData,
        userId: user.id
      }

      let res, savedWork

      if (currentWork?.isNew || !currentWork) {
        res = await fetch(`${API_BASE}/works`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(workData)
        })
        savedWork = await res.json()

        await handleThumbnailUpload(savedWork.id)
      } else {
        const thumbnail = await handleThumbnailUpload(currentWork.id)
        const updateData = { ...workData }
        if (thumbnail) updateData.thumbnail = thumbnail

        res = await fetch(`${API_BASE}/works/${currentWork.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData)
        })
        savedWork = await res.json()
      }

      setCurrentWork(savedWork)
      setShowSaveModal(false)
      setSaveTitle('')
      setSaveDescription('')
      fetchWorks()

      if (currentWork?.isNew) {
        connectWebSocket(savedWork.id)
      }
    } catch (e) {
      console.error('Save failed:', e)
    }
  }

  const handleExportVox = () => {
    const filename = currentWork?.title ? `${currentWork.title}.vox` : 'model.vox'
    exportToVox(voxelData, filename)
  }

  const handleExportSTL = () => {
    const filename = currentWork?.title ? `${currentWork.title}.stl` : 'model.stl'
    exportToSTL(voxelData, filename, 10)
  }

  const handleGenerateTerrain = () => {
    const options = {
      scale: terrainScale,
      heightMultiplier: terrainHeight,
      waterLevel: terrainWater,
      mountainHeight: terrainHeight * 0.8,
      riverWidth: 1,
      generateRivers: true
    }
    const newVoxelData = generateTerrain(terrainSeed, options)
    setVoxelData(newVoxelData)
    localTimestampsRef.current = new BigUint64Array(VOXEL_COUNT)

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const operations = []
      try {
        const binaryString = atob(newVoxelData)
        for (let i = 0; i < binaryString.length; i++) {
          const value = binaryString.charCodeAt(i)
          if (value > 0) {
            const x = i % CHUNK_SIZE
            const y = Math.floor((i / CHUNK_SIZE) % CHUNK_SIZE)
            const z = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE))
            operations.push({
              x, y, z, value,
              timestamp: getTimestamp()
            })
          }
        }
        if (operations.length > 0) {
          wsRef.current.send(JSON.stringify({
            type: 'crdtSync',
            operations
          }))
        }
      } catch (e) {
        console.error('Failed to sync terrain:', e)
      }
    }

    setShowTerrainModal(false)
  }

  const openSaveModal = () => {
    setSaveTitle(currentWork?.title || '')
    setSaveDescription(currentWork?.description || '')
    setShowSaveModal(true)
  }

  if (showLogin) {
    return (
      <div className="modal-overlay">
        <div className="modal">
          <h2>欢迎使用体素编辑器</h2>
          <div className="form-group">
            <label>你的名字</label>
            <input
              type="text"
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              placeholder="输入你的名字"
              maxLength={20}
            />
          </div>
          <div className="form-group">
            <label>选择颜色</label>
            <div className="color-grid" style={{ gridTemplateColumns: 'repeat(8, 1fr)' }}>
              {['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9', '#fd79a8', '#a29bfe',
                '#74b9ff', '#ff7675', '#00b894', '#e17055', '#6c5ce7', '#00cec9', '#fab1a0', '#fdcb6e'].map(color => (
                <div
                  key={color}
                  className={`color-swatch ${loginColor === color ? 'active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setLoginColor(color)}
                />
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={handleLogin} disabled={!loginName.trim()}>
              进入编辑器
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🎨 体素编辑器</h1>
        <div className="user-info">
          <div className="user-color" style={{ backgroundColor: user.color }} />
          <span>{user.name}</span>
        </div>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${sidebarTab === 'works' ? 'active' : ''}`}
              onClick={() => setSidebarTab('works')}
            >
              作品
            </button>
            <button
              className={`sidebar-tab ${sidebarTab === 'new' ? 'active' : ''}`}
              onClick={handleNewWork}
            >
              新建
            </button>
          </div>

          <div className="sidebar-content">
            {sidebarTab === 'works' && (
              <>
                {works.length === 0 ? (
                  <div className="empty-state">
                    <h3>暂无作品</h3>
                    <p>点击"新建"开始创作</p>
                  </div>
                ) : (
                  works.map(work => (
                    <div
                      key={work.id}
                      className="work-item"
                      onClick={() => handleLoadWork(work)}
                    >
                      <div className="work-thumb">
                        {work.thumbnail ? (
                          <img src={`http://localhost:3001${work.thumbnail}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
                        ) : (
                          <span>预览</span>
                        )}
                      </div>
                      <h3>{work.title}</h3>
                      <div className="work-meta">
                        <span style={{ color: work.user?.color }}>{work.user?.name}</span>
                        <span>{new Date(work.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </aside>

        <div className="editor-container">
          {!currentWork ? (
            <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <h3>选择或创建一个作品开始编辑</h3>
              <p>从左侧选择一个作品，或点击"新建"开始创作</p>
            </div>
          ) : (
            <>
              <div className="toolbar">
                <button
                  className={`tool-btn ${currentTool === 'add' ? 'active' : ''}`}
                  onClick={() => setCurrentTool('add')}
                >
                  ➕ 添加方块
                </button>
                <button
                  className={`tool-btn ${currentTool === 'remove' ? 'active' : ''}`}
                  onClick={() => setCurrentTool('remove')}
                >
                  ➖ 删除方块
                </button>
              </div>

              <div className="hint">
                左键点击：{currentTool === 'add' ? '在相邻位置添加方块' : '删除选中方块'} | 鼠标拖拽：旋转视角 | 滚轮：缩放
              </div>

              <div className="players-list">
                <h4>在线玩家 ({players.length + 1})</h4>
                <div className="player-item">
                  <div className="player-color" style={{ backgroundColor: user.color }} />
                  <span>{user.name} (你)</span>
                </div>
                {players.map(player => (
                  <div key={player.id} className="player-item">
                    <div className="player-color" style={{ backgroundColor: player.color }} />
                    <span>{player.name}</span>
                  </div>
                ))}
              </div>

              <div className="color-picker">
                <h4>选择颜色</h4>
                <div className="color-grid">
                  {COLORS.slice(0, 64).map((color, index) => (
                    <div
                      key={index}
                      className={`color-swatch ${currentColorIndex === index + 1 ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setCurrentColorIndex(index + 1)}
                    />
                  ))}
                </div>
              </div>

              <div className="toolbar">
                <button
                  className={`tool-btn ${lightingMode === 'standard' ? 'active' : ''}`}
                  onClick={() => setLightingMode('standard')}
                >
                  💡 标准光照
                </button>
                <button
                  className={`tool-btn ${lightingMode === 'pbr' ? 'active' : ''}`}
                  onClick={() => setLightingMode('pbr')}
                >
                  ✨ PBR 点光源
                </button>
                <button
                  className="tool-btn"
                  onClick={() => {
                    setTerrainSeed(String(Math.floor(Math.random() * 100000)))
                    setShowTerrainModal(true)
                  }}
                >
                  🏔️ 生成地形
                </button>
              </div>

              <div className="action-bar">
                <button className="btn secondary" onClick={openSaveModal} disabled={isUploadingThumbnail}>
                  {isUploadingThumbnail ? '上传中...' : '💾 保存'}
                </button>
                <button className="btn secondary" onClick={handleExportVox}>
                  📤 导出 .vox
                </button>
                <button className="btn" onClick={handleExportSTL}>
                  🖨️ 导出 .stl (3D打印)
                </button>
              </div>

              <VoxelEditor
                voxelData={voxelData}
                onVoxelChange={handleVoxelChange}
                currentTool={currentTool}
                currentColorIndex={currentColorIndex}
                players={players}
                lightingMode={lightingMode}
              />
            </>
          )}
        </div>
      </div>

      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>保存作品</h2>
            <div className="form-group">
              <label>标题</label>
              <input
                type="text"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="输入作品标题"
                maxLength={100}
              />
            </div>
            <div className="form-group">
              <label>描述 (可选)</label>
              <textarea
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                placeholder="描述一下你的作品..."
                maxLength={500}
              />
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setShowSaveModal(false)}>
                取消
              </button>
              <button className="btn" onClick={handleSave} disabled={!saveTitle.trim() || isUploadingThumbnail}>
                {isUploadingThumbnail ? '上传缩略图...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTerrainModal && (
        <div className="modal-overlay" onClick={() => setShowTerrainModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>🏔️ 生成地形</h2>
            <div className="form-group">
              <label>种子值 (相同种子生成相同地形)</label>
              <input
                type="text"
                value={terrainSeed}
                onChange={(e) => setTerrainSeed(e.target.value)}
                placeholder="输入任意字符串或数字"
              />
            </div>
            <div className="form-group">
              <label>地形复杂度: {terrainScale}</label>
              <input
                type="range"
                min="2"
                max="8"
                value={terrainScale}
                onChange={(e) => setTerrainScale(Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label>山脉高度: {terrainHeight}</label>
              <input
                type="range"
                min="4"
                max="14"
                value={terrainHeight}
                onChange={(e) => setTerrainHeight(Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label>水位高度: {terrainWater}</label>
              <input
                type="range"
                min="0"
                max="10"
                value={terrainWater}
                onChange={(e) => setTerrainWater(Number(e.target.value))}
              />
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setShowTerrainModal(false)}>
                取消
              </button>
              <button className="btn" onClick={handleGenerateTerrain}>
                生成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
