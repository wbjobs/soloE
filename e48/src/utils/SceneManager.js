import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import LightmapBaker from './LightmapBaker.js'

class SceneManager {
  constructor(container) {
    this.container = container
    this.scene = null
    this.camera = null
    this.renderer = null
    this.controls = null
    this.furniture = []
    this.staticFurniture = []
    this.walls = []
    this.floor = null
    this.lights = []
    this.raycaster = new THREE.Raycaster()
    this.mouse = new THREE.Vector2()
    this.selectedObject = null
    this.isDragging = false
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    this.lightmapBaker = null
    this.lightmapTexture = null
    this.isLightmapBaked = false
    this.roomConfig = null
    
    this.init()
  }

  init() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a2e)
    this.scene.fog = new THREE.Fog(0x1a1a2e, 20, 50)

    const { clientWidth, clientHeight } = this.container
    this.camera = new THREE.PerspectiveCamera(60, clientWidth / clientHeight, 0.1, 1000)
    this.camera.position.set(8, 10, 8)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(clientWidth, clientHeight)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.minDistance = 3
    this.controls.maxDistance = 30
    this.controls.maxPolarAngle = Math.PI / 2.1

    this.createGrid()
    this.setupEvents()
    this.animate()
  }

  createGrid() {
    const gridHelper = new THREE.GridHelper(30, 30, 0x444444, 0x333333)
    gridHelper.position.y = 0.01
    this.scene.add(gridHelper)
  }

  setupEvents() {
    window.addEventListener('resize', () => this.onResize())
    this.renderer.domElement.addEventListener('mousedown', (e) => this.onMouseDown(e))
    this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e))
    this.renderer.domElement.addEventListener('mouseup', () => this.onMouseUp())
    this.renderer.domElement.addEventListener('mouseleave', () => this.onMouseUp())
  }

  onResize() {
    const { clientWidth, clientHeight } = this.container
    this.camera.aspect = clientWidth / clientHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(clientWidth, clientHeight)
  }

  onMouseDown(event) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.mouse, this.camera)
    const allMeshes = []
    this.furniture.forEach(f => {
      f.mesh.traverse((child) => {
        if (child.isMesh) {
          child.userData.parentFurniture = f.mesh
          allMeshes.push(child)
        }
      })
    })
    
    const intersects = this.raycaster.intersectObjects(allMeshes)

    if (intersects.length > 0) {
      this.controls.enabled = false
      this.isDragging = true
      this.selectedObject = intersects[0].object.userData.parentFurniture
      this.setEmission(this.selectedObject, 0x333333)
    }
  }

  setEmission(group, color) {
    group.traverse((child) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => {
            if (m.emissive) m.emissive.setHex(color)
          })
        } else if (child.material.emissive) {
          child.material.emissive.setHex(color)
        }
      }
    })
  }

  onMouseMove(event) {
    if (!this.isDragging || !this.selectedObject) return

    const rect = this.renderer.domElement.getBoundingClientRect()
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.mouse, this.camera)
    const intersection = new THREE.Vector3()
    this.raycaster.ray.intersectPlane(this.dragPlane, intersection)

    if (intersection) {
      this.selectedObject.position.x = Math.round(intersection.x * 2) / 2
      this.selectedObject.position.z = Math.round(intersection.z * 2) / 2
    }
  }

  onMouseUp() {
    if (this.selectedObject) {
      this.setEmission(this.selectedObject, 0x000000)
    }
    this.isDragging = false
    this.selectedObject = null
    this.controls.enabled = true
  }

  clearRoom() {
    this.clearLightmap()
    
    if (this.floor) {
      this.scene.remove(this.floor)
      this.floor = null
    }
    this.walls.forEach(wall => this.scene.remove(wall))
    this.walls = []
    this.clearFurniture()
    this.clearLights()
    this.roomConfig = null
  }

  clearFurniture() {
    this.furniture.forEach(f => this.scene.remove(f.mesh))
    this.furniture = []
    this.staticFurniture = []
  }

  clearLights() {
    this.lights.forEach(light => this.scene.remove(light))
    this.lights = []
  }

  clearLightmap() {
    if (this.lightmapBaker) {
      this.lightmapBaker.dispose()
      this.lightmapBaker = null
    }
    if (this.lightmapTexture) {
      this.lightmapTexture.dispose()
      this.lightmapTexture = null
    }
    this.isLightmapBaked = false
    
    if (this.floor && this.floor.userData.originalMaterial) {
      this.floor.material = this.floor.userData.originalMaterial
      delete this.floor.userData.originalMaterial
    }
    
    this.walls.forEach(wall => {
      if (wall.userData.originalMaterial) {
        wall.material = wall.userData.originalMaterial
        delete wall.userData.originalMaterial
      }
    })
    
    this.staticFurniture.forEach(f => {
      if (f.mesh.userData.originalMaterial) {
        f.mesh.traverse(child => {
          if (child.isMesh && child.userData.originalMaterial) {
            child.material = child.userData.originalMaterial
            delete child.userData.originalMaterial
          }
        })
      }
    })
  }

  bakeLightmap() {
    if (!this.lightmapBaker) {
      this.lightmapBaker = new LightmapBaker(this)
    }

    const staticObjects = []
    
    if (this.floor) {
      staticObjects.push(this.floor)
    }
    staticObjects.push(...this.walls)
    
    this.staticFurniture.forEach(f => {
      f.mesh.traverse(child => {
        if (child.isMesh) {
          staticObjects.push(child)
        }
      })
    })

    this.lightmapTexture = this.lightmapBaker.bakeStaticObjects(
      staticObjects, 
      this.lights
    )

    this.applyLightmapToStaticObjects()
    this.isLightmapBaked = true
    
    this.disableStaticShadows()
    
    return this.lightmapTexture
  }

  applyLightmapToStaticObjects() {
    if (!this.lightmapTexture) return

    if (this.floor) {
      this.prepareUV2(this.floor)
      this.applyLightmapShader(this.floor)
    }

    this.walls.forEach(wall => {
      this.prepareUV2(wall)
      this.applyLightmapShader(wall)
    })

    this.staticFurniture.forEach(f => {
      f.mesh.traverse(child => {
        if (child.isMesh) {
          this.prepareUV2(child)
          this.applyLightmapShader(child)
        }
      })
    })
  }

  prepareUV2(mesh) {
    if (!mesh.geometry) return
    
    if (!mesh.geometry.attributes.uv2) {
      const uvAttribute = mesh.geometry.attributes.uv
      if (uvAttribute) {
        mesh.geometry.setAttribute('uv2', uvAttribute.clone())
      } else {
        const position = mesh.geometry.attributes.position
        if (position) {
          const uvs = new Float32Array(position.count * 2)
          for (let i = 0; i < position.count; i++) {
            uvs[i * 2] = position.getX(i) / 10 + 0.5
            uvs[i * 2 + 1] = position.getZ(i) / 10 + 0.5
          }
          mesh.geometry.setAttribute('uv2', new THREE.BufferAttribute(uvs, 2))
        }
      }
    }
  }

  applyLightmapShader(mesh) {
    if (!mesh.material || !this.lightmapTexture) return

    const baseColor = mesh.material.color || new THREE.Color(0x888888)
    const baseTexture = this.createSolidTexture(baseColor)

    const shaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        baseColor: { value: baseColor },
        lightMap: { value: this.lightmapTexture },
        lightMapIntensity: { value: 1.5 },
        ambientIntensity: { value: 0.3 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec2 vUv2;
        varying vec3 vNormal;

        void main() {
          vUv = uv;
          vUv2 = uv2;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 baseColor;
        uniform sampler2D lightMap;
        uniform float lightMapIntensity;
        uniform float ambientIntensity;

        varying vec2 vUv;
        varying vec2 vUv2;
        varying vec3 vNormal;

        void main() {
          vec4 lightSample = texture2D(lightMap, vUv2);
          
          vec3 normal = normalize(vNormal);
          float NdotL = max(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0);
          
          vec3 litColor = baseColor * lightSample.rgb * lightMapIntensity;
          litColor += baseColor * ambientIntensity;
          
          float fresnel = pow(1.0 - abs(normal.y), 2.0) * 0.1;
          litColor += vec3(fresnel);
          
          gl_FragColor = vec4(litColor, 1.0);
        }
      `,
      side: THREE.DoubleSide
    })

    mesh.userData.originalMaterial = mesh.material
    mesh.material = shaderMaterial
  }

  createSolidTexture(color) {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 2
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = `#${color.getHexString()}`
    ctx.fillRect(0, 0, 2, 2)
    
    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  }

  disableStaticShadows() {
    if (this.floor) {
      this.floor.castShadow = false
      this.floor.receiveShadow = false
    }
    
    this.walls.forEach(wall => {
      wall.castShadow = false
      wall.receiveShadow = false
    })
    
    this.staticFurniture.forEach(f => {
      f.mesh.traverse(child => {
        if (child.isMesh) {
          child.castShadow = false
          child.receiveShadow = false
        }
      })
    })

    this.lights.forEach(light => {
      if (light.isDirectionalLight || light.isSpotLight) {
        light.castShadow = false
      }
    })
  }

  markFurnitureAsStatic(index) {
    if (index >= 0 && index < this.furniture.length) {
      const furniture = this.furniture.splice(index, 1)[0]
      this.staticFurniture.push(furniture)
      furniture.mesh.traverse(child => {
        if (child.isMesh) {
          child.userData.isStatic = true
        }
      })
    }
  }

  markAllFurnitureAsStatic() {
    while (this.furniture.length > 0) {
      this.markFurnitureAsStatic(0)
    }
  }

  createRoom(config) {
    this.clearRoom()
    const { shape, width, depth, height = 2.8 } = config

    if (shape === 'rectangle') {
      this.createRectangularRoom(width, depth, height)
    } else if (shape === 'L-shape') {
      this.createLRoom(width, depth, height)
    }

    this.setupLights(config)
    this.camera.lookAt(width / 2, 0, depth / 2)
  }

  createRectangularRoom(width, depth, height) {
    const floorGeometry = new THREE.PlaneGeometry(width, depth)
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.8,
      metalness: 0.2
    })
    this.floor = new THREE.Mesh(floorGeometry, floorMaterial)
    this.floor.rotation.x = -Math.PI / 2
    this.floor.position.set(width / 2, 0, depth / 2)
    this.floor.receiveShadow = true
    this.scene.add(this.floor)

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5f5f5,
      roughness: 0.9,
      side: THREE.DoubleSide
    })

    const wallPositions = [
      { pos: [width / 2, height / 2, 0], rot: [0, 0, 0], size: [width, height] },
      { pos: [width / 2, height / 2, depth], rot: [0, 0, 0], size: [width, height] },
      { pos: [0, height / 2, depth / 2], rot: [0, Math.PI / 2, 0], size: [depth, height] },
      { pos: [width, height / 2, depth / 2], rot: [0, Math.PI / 2, 0], size: [depth, height] }
    ]

    wallPositions.forEach(w => {
      const wallGeometry = new THREE.PlaneGeometry(w.size[0], w.size[1])
      const wall = new THREE.Mesh(wallGeometry, wallMaterial)
      wall.position.set(...w.pos)
      wall.rotation.set(...w.rot)
      wall.receiveShadow = true
      this.walls.push(wall)
      this.scene.add(wall)
    })
  }

  createLRoom(width, depth, height) {
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.8,
      metalness: 0.2
    })

    const floor1 = new THREE.Mesh(new THREE.PlaneGeometry(width, depth * 0.6), floorMaterial)
    floor1.rotation.x = -Math.PI / 2
    floor1.position.set(width / 2, 0, depth * 0.3)
    floor1.receiveShadow = true
    this.scene.add(floor1)

    const floor2 = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.4, depth * 0.4), floorMaterial)
    floor2.rotation.x = -Math.PI / 2
    floor2.position.set(width * 0.8, 0, depth * 0.8)
    floor2.receiveShadow = true
    this.scene.add(floor2)

    this.floor = { width, depth }

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5f5f5,
      roughness: 0.9,
      side: THREE.DoubleSide
    })

    const walls = [
      { pos: [width / 2, height / 2, 0], size: [width, height] },
      { pos: [width * 0.3, height / 2, depth], size: [width * 0.6, height] },
      { pos: [0, height / 2, depth * 0.3], size: [depth * 0.6, height], rotY: Math.PI / 2 },
      { pos: [width, height / 2, depth / 2], size: [depth, height], rotY: Math.PI / 2 },
      { pos: [width * 0.6, height / 2, depth * 0.6], size: [depth * 0.4, height], rotY: Math.PI / 2 },
      { pos: [width * 0.8, height / 2, depth * 0.6], size: [width * 0.4, height], rotY: 0 }
    ]

    walls.forEach(w => {
      const wallGeometry = new THREE.PlaneGeometry(w.size[0], w.size[1])
      const wall = new THREE.Mesh(wallGeometry, wallMaterial)
      wall.position.set(...w.pos)
      if (w.rotY) wall.rotation.y = w.rotY
      wall.receiveShadow = true
      this.walls.push(wall)
      this.scene.add(wall)
    })
  }

  setupLights(config) {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    this.scene.add(ambientLight)
    this.lights.push(ambientLight)

    const sunLight = new THREE.DirectionalLight(0xffffee, 0.8)
    sunLight.position.set(config.width * 0.5, 10, -5)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.width = 2048
    sunLight.shadow.mapSize.height = 2048
    sunLight.shadow.camera.near = 0.5
    sunLight.shadow.camera.far = 50
    sunLight.shadow.camera.left = -10
    sunLight.shadow.camera.right = 20
    sunLight.shadow.camera.top = 20
    sunLight.shadow.camera.bottom = -10
    this.scene.add(sunLight)
    this.lights.push(sunLight)

    const pointPositions = [
      { x: config.width * 0.25, z: config.depth * 0.25 },
      { x: config.width * 0.75, z: config.depth * 0.75 },
      { x: config.width * 0.5, z: config.depth * 0.5 }
    ]

    pointPositions.forEach(pos => {
      const pointLight = new THREE.PointLight(0xffeedd, 0.5, 10)
      pointLight.position.set(pos.x, 2.5, pos.z)
      pointLight.castShadow = true
      this.scene.add(pointLight)
      this.lights.push(pointLight)
    })
  }

  addFurniture(type, position, rotation = 0) {
    const furnitureData = this.createFurnitureMesh(type)
    if (!furnitureData) return null

    const mesh = furnitureData.mesh
    mesh.position.set(position.x, furnitureData.height / 2, position.z)
    mesh.rotation.y = rotation
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData = { type, width: furnitureData.width, depth: furnitureData.depth, height: furnitureData.height }

    this.scene.add(mesh)
    this.furniture.push({ mesh, type, ...furnitureData })
    return mesh
  }

  createFurnitureMesh(type) {
    let geometry, material, width, depth, height

    switch (type) {
      case 'sofa':
        width = 2.2
        depth = 0.9
        height = 0.8
        const sofaGroup = new THREE.Group()
        
        const baseGeo = new THREE.BoxGeometry(width, 0.3, depth)
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x4a6fa5, roughness: 0.7 })
        const base = new THREE.Mesh(baseGeo, baseMat)
        base.position.y = 0.15
        sofaGroup.add(base)

        const backGeo = new THREE.BoxGeometry(width, 0.6, 0.15)
        const back = new THREE.Mesh(backGeo, baseMat)
        back.position.set(0, 0.6, -depth / 2 + 0.075)
        sofaGroup.add(back)

        const armGeo = new THREE.BoxGeometry(0.15, 0.5, depth - 0.15)
        const leftArm = new THREE.Mesh(armGeo, baseMat)
        leftArm.position.set(-width / 2 + 0.075, 0.4, 0)
        sofaGroup.add(leftArm)

        const rightArm = new THREE.Mesh(armGeo, baseMat)
        rightArm.position.set(width / 2 - 0.075, 0.4, 0)
        sofaGroup.add(rightArm)

        return { mesh: sofaGroup, width, depth, height }

      case 'bed':
        width = 1.8
        depth = 2.2
        height = 0.6
        const bedGroup = new THREE.Group()

        const bedBaseGeo = new THREE.BoxGeometry(width, 0.3, depth)
        const bedBaseMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8 })
        const bedBase = new THREE.Mesh(bedBaseGeo, bedBaseMat)
        bedBase.position.y = 0.15
        bedGroup.add(bedBase)

        const mattressGeo = new THREE.BoxGeometry(width - 0.1, 0.2, depth - 0.1)
        const mattressMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
        const mattress = new THREE.Mesh(mattressGeo, mattressMat)
        mattress.position.y = 0.4
        bedGroup.add(mattress)

        const headboardGeo = new THREE.BoxGeometry(width, 0.8, 0.1)
        const headboardMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.7 })
        const headboard = new THREE.Mesh(headboardGeo, headboardMat)
        headboard.position.set(0, 0.7, -depth / 2 + 0.05)
        bedGroup.add(headboard)

        return { mesh: bedGroup, width, depth, height }

      case 'table':
        width = 1.4
        depth = 0.8
        height = 0.75
        const tableGroup = new THREE.Group()

        const tableTopGeo = new THREE.BoxGeometry(width, 0.08, depth)
        const tableTopMat = new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.6 })
        const tableTop = new THREE.Mesh(tableTopGeo, tableTopMat)
        tableTop.position.y = height - 0.04
        tableGroup.add(tableTop)

        const legGeo = new THREE.BoxGeometry(0.08, height - 0.08, 0.08)
        const legPositions = [
          [-width / 2 + 0.06, (height - 0.08) / 2, -depth / 2 + 0.06],
          [width / 2 - 0.06, (height - 0.08) / 2, -depth / 2 + 0.06],
          [-width / 2 + 0.06, (height - 0.08) / 2, depth / 2 - 0.06],
          [width / 2 - 0.06, (height - 0.08) / 2, depth / 2 - 0.06]
        ]
        legPositions.forEach(pos => {
          const leg = new THREE.Mesh(legGeo, tableTopMat)
          leg.position.set(...pos)
          tableGroup.add(leg)
        })

        return { mesh: tableGroup, width, depth, height }

      case 'chair':
        width = 0.5
        depth = 0.5
        height = 0.9
        const chairGroup = new THREE.Group()

        const seatGeo = new THREE.BoxGeometry(width, 0.08, depth)
        const seatMat = new THREE.MeshStandardMaterial({ color: 0x654321, roughness: 0.7 })
        const seat = new THREE.Mesh(seatGeo, seatMat)
        seat.position.y = 0.45
        chairGroup.add(seat)

        const chairLegGeo = new THREE.BoxGeometry(0.06, 0.45, 0.06)
        const chairLegPositions = [
          [-width / 2 + 0.05, 0.225, -depth / 2 + 0.05],
          [width / 2 - 0.05, 0.225, -depth / 2 + 0.05],
          [-width / 2 + 0.05, 0.225, depth / 2 - 0.05],
          [width / 2 - 0.05, 0.225, depth / 2 - 0.05]
        ]
        chairLegPositions.forEach(pos => {
          const leg = new THREE.Mesh(chairLegGeo, seatMat)
          leg.position.set(...pos)
          chairGroup.add(leg)
        })

        const backrestGeo = new THREE.BoxGeometry(width - 0.1, 0.5, 0.05)
        const backrest = new THREE.Mesh(backrestGeo, seatMat)
        backrest.position.set(0, 0.75, -depth / 2 + 0.05)
        chairGroup.add(backrest)

        return { mesh: chairGroup, width, depth, height }

      case 'cabinet':
        width = 1.2
        depth = 0.45
        height = 2.0
        const cabinetGroup = new THREE.Group()

        const cabinetBodyGeo = new THREE.BoxGeometry(width, height, depth)
        const cabinetMat = new THREE.MeshStandardMaterial({ color: 0xdeb887, roughness: 0.7 })
        const cabinetBody = new THREE.Mesh(cabinetBodyGeo, cabinetMat)
        cabinetBody.position.y = height / 2
        cabinetGroup.add(cabinetBody)

        const handleGeo = new THREE.BoxGeometry(0.1, 0.05, 0.02)
        const handleMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.3 })
        const handle1 = new THREE.Mesh(handleGeo, handleMat)
        handle1.position.set(-0.25, height / 2, depth / 2 + 0.01)
        cabinetGroup.add(handle1)

        const handle2 = new THREE.Mesh(handleGeo, handleMat)
        handle2.position.set(0.25, height / 2, depth / 2 + 0.01)
        cabinetGroup.add(handle2)

        return { mesh: cabinetGroup, width, depth, height }

      default:
        return null
    }
  }

  getRoomBounds() {
    if (this.floor && this.floor.width) {
      return {
        minX: 0.5,
        maxX: this.floor.width - 0.5,
        minZ: 0.5,
        maxZ: this.floor.depth - 0.5,
        width: this.floor.width,
        depth: this.floor.depth
      }
    }
    return null
  }

  animate() {
    requestAnimationFrame(() => this.animate())
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  destroy() {
    this.renderer.dispose()
    this.controls.dispose()
  }
}

export default SceneManager
