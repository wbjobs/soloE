import * as THREE from 'three'

class LightmapBaker {
  constructor(sceneManager) {
    this.sceneManager = sceneManager
    this.lightmapSize = 512
    this.bakeCamera = null
    this.bakeRenderTarget = null
    this.bakeScene = null
    this.isBaked = false
  }

  initBake() {
    this.bakeRenderTarget = new THREE.WebGLRenderTarget(this.lightmapSize, this.lightmapSize, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter
    })

    this.bakeScene = new THREE.Scene()
    this.bakeScene.background = new THREE.Color(0x000000)

    const roomBounds = this.getRoomBounds()
    const centerX = (roomBounds.minX + roomBounds.maxX) / 2
    const centerZ = (roomBounds.minZ + roomBounds.maxZ) / 2

    this.bakeCamera = new THREE.OrthographicCamera(
      roomBounds.minX - centerX,
      roomBounds.maxX - centerX,
      roomBounds.maxZ - centerZ,
      roomBounds.minZ - centerZ,
      0.1,
      100
    )
    this.bakeCamera.position.set(centerX, 50, centerZ)
    this.bakeCamera.lookAt(centerX, 0, centerZ)
  }

  getRoomBounds() {
    const { width, depth } = this.sceneManager.floor || { width: 8, depth: 6 }
    return {
      minX: 0,
      maxX: typeof width === 'number' ? width : 8,
      minZ: 0,
      maxZ: typeof depth === 'number' ? depth : 6
    }
  }

  createBakeUVs(mesh, offsetX, offsetZ, scaleX, scaleZ) {
    if (!mesh.geometry) return
    
    const uvAttribute = mesh.geometry.attributes.uv
    if (!uvAttribute) return

    const uvs = uvAttribute.array.slice()
    
    for (let i = 0; i < uvs.length; i += 2) {
      uvs[i] = (uvs[i] * scaleX + offsetX) * 0.95 + 0.025
      uvs[i + 1] = (uvs[i + 1] * scaleZ + offsetZ) * 0.95 + 0.025
    }

    mesh.geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2))
  }

  bakeStaticObjects(staticObjects, lights) {
    this.initBake()

    const bakeMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x000000,
      roughness: 0.8,
      metalness: 0.1,
      side: THREE.DoubleSide
    })

    staticObjects.forEach(obj => {
      const clone = obj.clone()
      clone.material = bakeMaterial.clone()
      
      if (obj.material) {
        clone.material.color.copy(obj.material.color || new THREE.Color(0x888888))
        clone.material.roughness = obj.material.roughness || 0.8
        clone.material.metalness = obj.material.metalness || 0.1
      }
      
      this.bakeScene.add(clone)
    })

    lights.forEach(light => {
      const lightClone = light.clone()
      lightClone.castShadow = true
      if (lightClone.shadow) {
        lightClone.shadow.mapSize.width = 1024
        lightClone.shadow.mapSize.height = 1024
        lightClone.shadow.bias = -0.0001
      }
      this.bakeScene.add(lightClone)
    })

    const ambientBake = new THREE.AmbientLight(0xffffff, 0.3)
    this.bakeScene.add(ambientBake)

    const renderer = this.sceneManager.renderer
    const originalClearColor = renderer.getClearColor(new THREE.Color())
    
    renderer.setClearColor(0x000000)
    renderer.setRenderTarget(this.bakeRenderTarget)
    renderer.render(this.bakeScene, this.bakeCamera)
    renderer.setRenderTarget(null)
    renderer.setClearColor(originalClearColor)

    this.bakeScene.clear()
    this.isBaked = true

    return this.bakeRenderTarget.texture
  }

  createLightmapShader(baseTexture, lightmap) {
    return {
      uniforms: {
        baseTexture: { value: baseTexture },
        lightMap: { value: lightmap },
        lightMapIntensity: { value: 1.2 },
        emissiveIntensity: { value: 0.1 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec2 vUv2;
        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
          vUv = uv;
          vUv2 = uv2;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D baseTexture;
        uniform sampler2D lightMap;
        uniform float lightMapIntensity;
        uniform float emissiveIntensity;

        varying vec2 vUv;
        varying vec2 vUv2;
        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
          vec4 baseColor = texture2D(baseTexture, vUv);
          vec4 lightColor = texture2D(lightMap, vUv2);
          
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
          
          vec3 finalColor = baseColor.rgb * lightColor.rgb * lightMapIntensity;
          finalColor += baseColor.rgb * emissiveIntensity;
          finalColor += vec3(0.02) * fresnel;
          
          gl_FragColor = vec4(finalColor, baseColor.a);
        }
      `
    }
  }

  applyLightmapToObject(mesh, lightmap, baseColorTexture = null) {
    if (!mesh.geometry) return

    if (!mesh.geometry.attributes.uv2) {
      const uvAttribute = mesh.geometry.attributes.uv
      if (uvAttribute) {
        mesh.geometry.setAttribute('uv2', uvAttribute.clone())
      }
    }

    const shaderDef = this.createLightmapShader(
      baseColorTexture || this.createColorTexture(mesh.material?.color || new THREE.Color(0x888888)),
      lightmap
    )

    const shaderMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(shaderDef.uniforms),
      vertexShader: shaderDef.vertexShader,
      fragmentShader: shaderDef.fragmentShader,
      side: THREE.DoubleSide
    })

    mesh.userData.originalMaterial = mesh.material
    mesh.material = shaderMaterial
  }

  createColorTexture(color) {
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

  restoreOriginalMaterial(mesh) {
    if (mesh.userData.originalMaterial) {
      mesh.material = mesh.userData.originalMaterial
      delete mesh.userData.originalMaterial
    }
  }

  dispose() {
    if (this.bakeRenderTarget) {
      this.bakeRenderTarget.dispose()
    }
    this.isBaked = false
  }
}

export default LightmapBaker
