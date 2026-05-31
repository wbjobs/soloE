import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { colorIndexToHex } from '../utils/colorUtils.js'

const CHUNK_SIZE = 16
const VOXEL_SIZE = 1

export default function VoxelEditor({
  voxelData,
  onVoxelChange,
  currentTool,
  currentColorIndex,
  players = [],
  onPlayerMove,
  lightingMode = 'standard'
}) {
  const containerRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const rendererRef = useRef(null)
  const controlsRef = useRef(null)
  const voxelMeshesRef = useRef(new Map())
  const highlightRef = useRef(null)
  const playerBoxesRef = useRef(new Map())
  const raycasterRef = useRef(new THREE.Raycaster())
  const mouseRef = useRef(new THREE.Vector2())
  const animationIdRef = useRef(null)
  const lightsRef = useRef({})
  const [hoveredVoxel, setHoveredVoxel] = useState(null)

  useEffect(() => {
    if (!containerRef.current) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a14)
    scene.fog = new THREE.Fog(0x0a0a14, 30, 80)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    )
    camera.position.set(CHUNK_SIZE, CHUNK_SIZE * 1.2, CHUNK_SIZE * 1.5)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.target.set(CHUNK_SIZE / 2, CHUNK_SIZE / 2, CHUNK_SIZE / 2)
    controlsRef.current = controls

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambientLight)
    lightsRef.current.ambient = ambientLight

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2)
    directionalLight.position.set(20, 30, 20)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 100
    directionalLight.shadow.camera.left = -30
    directionalLight.shadow.camera.right = 30
    directionalLight.shadow.camera.top = 30
    directionalLight.shadow.camera.bottom = -30
    directionalLight.shadow.bias = -0.0001
    scene.add(directionalLight)
    lightsRef.current.directional = directionalLight

    const pointLight1 = new THREE.PointLight(0xff6b6b, 0, 50, 2)
    pointLight1.position.set(0, CHUNK_SIZE, 0)
    pointLight1.castShadow = true
    pointLight1.shadow.mapSize.width = 1024
    pointLight1.shadow.mapSize.height = 1024
    scene.add(pointLight1)
    lightsRef.current.point1 = pointLight1

    const pointLight2 = new THREE.PointLight(0x4ecdc4, 0, 50, 2)
    pointLight2.position.set(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE)
    pointLight2.castShadow = true
    pointLight2.shadow.mapSize.width = 1024
    pointLight2.shadow.mapSize.height = 1024
    scene.add(pointLight2)
    lightsRef.current.point2 = pointLight2

    const pointLight3 = new THREE.PointLight(0xffeaa7, 0, 50, 2)
    pointLight3.position.set(CHUNK_SIZE / 2, CHUNK_SIZE, CHUNK_SIZE / 2)
    pointLight3.castShadow = true
    pointLight3.shadow.mapSize.width = 1024
    pointLight3.shadow.mapSize.height = 1024
    scene.add(pointLight3)
    lightsRef.current.point3 = pointLight3

    const gridHelper = new THREE.GridHelper(CHUNK_SIZE, CHUNK_SIZE, 0x1a4a7a, 0x0f3460)
    gridHelper.position.set(CHUNK_SIZE / 2, 0, CHUNK_SIZE / 2)
    gridHelper.receiveShadow = true
    scene.add(gridHelper)

    const edges = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE)
    )
    const chunkBounds = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x1a4a7a, transparent: true, opacity: 0.3 })
    )
    chunkBounds.position.set(CHUNK_SIZE / 2, CHUNK_SIZE / 2, CHUNK_SIZE / 2)
    scene.add(chunkBounds)

    const highlightGeo = new THREE.BoxGeometry(VOXEL_SIZE + 0.02, VOXEL_SIZE + 0.02, VOXEL_SIZE + 0.02)
    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.5,
      wireframe: true
    })
    const highlight = new THREE.Mesh(highlightGeo, highlightMat)
    highlight.visible = false
    scene.add(highlight)
    highlightRef.current = highlight

    let time = 0
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)
      time += 0.01

      if (lightingMode === 'pbr') {
        pointLight1.intensity = 0.8 + Math.sin(time * 0.5) * 0.2
        pointLight2.intensity = 0.6 + Math.cos(time * 0.7) * 0.2
        pointLight3.intensity = 0.4 + Math.sin(time * 0.3 + 1) * 0.2

        pointLight1.position.x = CHUNK_SIZE + Math.sin(time * 0.3) * 5
        pointLight1.position.z = Math.cos(time * 0.3) * 5
        pointLight2.position.x = Math.cos(time * 0.4) * 5
        pointLight2.position.z = CHUNK_SIZE + Math.sin(time * 0.4) * 5
      }

      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const handleResize = () => {
      if (!containerRef.current) return
      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationIdRef.current)
      renderer.dispose()
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement)
      }
    }
  }, [])

  useEffect(() => {
    const lights = lightsRef.current
    if (!lights.point1) return

    if (lightingMode === 'pbr') {
      lights.ambient.intensity = 0.2
      lights.directional.intensity = 0.6
      lights.point1.intensity = 0.8
      lights.point2.intensity = 0.6
      lights.point3.intensity = 0.5
      if (rendererRef.current) {
        rendererRef.current.toneMappingExposure = 1.2
      }
    } else {
      lights.ambient.intensity = 0.5
      lights.directional.intensity = 1.0
      lights.point1.intensity = 0
      lights.point2.intensity = 0
      lights.point3.intensity = 0
      if (rendererRef.current) {
        rendererRef.current.toneMappingExposure = 1.0
      }
    }

    if (sceneRef.current) {
      rebuildVoxelMeshes()
    }
  }, [lightingMode])

  const rebuildVoxelMeshes = useCallback(() => {
    if (!sceneRef.current || !voxelData) return

    const scene = sceneRef.current
    voxelMeshesRef.current.forEach(mesh => scene.remove(mesh))
    voxelMeshesRef.current.clear()

    let dataArray
    try {
      const binaryString = atob(voxelData)
      dataArray = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        dataArray[i] = binaryString.charCodeAt(i)
      }
    } catch (e) {
      return
    }

    const geometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE)
    const isPBR = lightingMode === 'pbr'

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE
          const colorIndex = dataArray[index]

          if (colorIndex > 0) {
            const colorHex = colorIndexToHex(colorIndex)
            let material
            if (isPBR) {
              material = new THREE.MeshStandardMaterial({
                color: colorHex,
                roughness: 0.5,
                metalness: 0.1
              })
            } else {
              material = new THREE.MeshLambertMaterial({ color: colorHex })
            }
            const mesh = new THREE.Mesh(geometry, material)
            mesh.position.set(x + 0.5, y + 0.5, z + 0.5)
            mesh.castShadow = true
            mesh.receiveShadow = true
            mesh.userData = { x, y, z, colorIndex }
            scene.add(mesh)
            voxelMeshesRef.current.set(`${x},${y},${z}`, mesh)
          }
        }
      }
    }
  }, [voxelData, lightingMode])

  useEffect(() => {
    rebuildVoxelMeshes()
  }, [rebuildVoxelMeshes])

  useEffect(() => {
    if (!sceneRef.current) return

    const scene = sceneRef.current
    playerBoxesRef.current.forEach(box => scene.remove(box))
    playerBoxesRef.current.clear()

    players.forEach(player => {
      const boxGeo = new THREE.BoxGeometry(1.2, 2, 1.2)
      const boxMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(player.color),
        transparent: true,
        opacity: 0.3,
        wireframe: false
      })
      const wireframeMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(player.color),
        wireframe: true,
        transparent: true,
        opacity: 0.8
      })

      const group = new THREE.Group()
      const solidBox = new THREE.Mesh(boxGeo, boxMat)
      const wireBox = new THREE.Mesh(boxGeo, wireframeMat)
      group.add(solidBox)
      group.add(wireBox)

      const edges = new THREE.EdgesGeometry(boxGeo)
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: new THREE.Color(player.color), linewidth: 2 })
      )
      group.add(line)

      group.position.set(
        player.position.x + 0.5,
        player.position.y + 1,
        player.position.z + 0.5
      )
      group.userData = { playerId: player.id }

      scene.add(group)
      playerBoxesRef.current.set(player.id, group)
    })
  }, [players])

  useEffect(() => {
    if (!rendererRef.current || !cameraRef.current || !sceneRef.current) return

    const canvas = rendererRef.current.domElement
    canvas.id = 'three-canvas'

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current)
      const meshes = Array.from(voxelMeshesRef.current.values())
      const intersects = raycasterRef.current.intersectObjects(meshes)

      if (intersects.length > 0) {
        const hit = intersects[0]
        const { x, y, z } = hit.object.userData
        setHoveredVoxel({ x, y, z })

        if (highlightRef.current) {
          if (currentTool === 'add') {
            const normal = hit.face.normal
            const nx = Math.round(normal.x)
            const ny = Math.round(normal.y)
            const nz = Math.round(normal.z)
            highlightRef.current.position.set(
              x + nx + 0.5,
              y + ny + 0.5,
              z + nz + 0.5
            )
          } else {
            highlightRef.current.position.set(x + 0.5, y + 0.5, z + 0.5)
          }
          highlightRef.current.visible = true
        }
      } else {
        setHoveredVoxel(null)
        if (highlightRef.current) {
          highlightRef.current.visible = false
        }
      }
    }

    const handleClick = (e) => {
      if (!hoveredVoxel) return

      const { x, y, z } = hoveredVoxel

      if (currentTool === 'remove') {
        onVoxelChange(x, y, z, 0)
      } else if (currentTool === 'add') {
        raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current)
        const meshes = Array.from(voxelMeshesRef.current.values())
        const intersects = raycasterRef.current.intersectObjects(meshes)

        if (intersects.length > 0) {
          const normal = intersects[0].face.normal
          const nx = Math.round(normal.x)
          const ny = Math.round(normal.y)
          const nz = Math.round(normal.z)
          const newX = x + nx
          const newY = y + ny
          const newZ = z + nz

          if (newX >= 0 && newX < CHUNK_SIZE && newY >= 0 && newY < CHUNK_SIZE && newZ >= 0 && newZ < CHUNK_SIZE) {
            onVoxelChange(newX, newY, newZ, currentColorIndex)
          }
        }
      }
    }

    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('click', handleClick)

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('click', handleClick)
    }
  }, [hoveredVoxel, currentTool, currentColorIndex, onVoxelChange])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  )
}
