import * as THREE from 'three'

export class SceneManager {
  constructor(container) {
    this.container = container
    this.scene = null
    this.camera = null
    this.renderer = null
    this.meshes = new Map()
    this.init()
  }

  init() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0a0a1a)
    this.scene.fog = new THREE.Fog(0x0a0a1a, 20, 50)

    const { clientWidth, clientHeight } = this.container
    this.camera = new THREE.PerspectiveCamera(60, clientWidth / clientHeight, 0.1, 100)
    this.camera.position.set(0, 8, 12)
    this.camera.lookAt(0, 2, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(clientWidth, clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2

    this.container.appendChild(this.renderer.domElement)

    this.setupLights()

    window.addEventListener('resize', () => this.onResize())
  }

  setupLights() {
    const ambientLight = new THREE.AmbientLight(0x404080, 0.5)
    this.scene.add(ambientLight)

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2)
    mainLight.position.set(5, 10, 5)
    mainLight.castShadow = true
    mainLight.shadow.mapSize.width = 2048
    mainLight.shadow.mapSize.height = 2048
    mainLight.shadow.camera.near = 0.5
    mainLight.shadow.camera.far = 50
    mainLight.shadow.camera.left = -15
    mainLight.shadow.camera.right = 15
    mainLight.shadow.camera.top = 15
    mainLight.shadow.camera.bottom = -15
    this.scene.add(mainLight)

    const fillLight = new THREE.DirectionalLight(0x00e5ff, 0.4)
    fillLight.position.set(-5, 5, -5)
    this.scene.add(fillLight)

    const pointLight1 = new THREE.PointLight(0xff1744, 1, 10)
    pointLight1.position.set(-3, 3, 0)
    this.scene.add(pointLight1)

    const pointLight2 = new THREE.PointLight(0x00e676, 1, 10)
    pointLight2.position.set(3, 3, 0)
    this.scene.add(pointLight2)
  }

  addMesh(name, mesh) {
    this.meshes.set(name, mesh)
    this.scene.add(mesh)
    return mesh
  }

  getMesh(name) {
    return this.meshes.get(name)
  }

  removeMesh(name) {
    const mesh = this.meshes.get(name)
    if (mesh) {
      this.scene.remove(mesh)
      this.meshes.delete(name)
    }
  }

  createBall(radius = 0.3, color = 0xffea00) {
    const geometry = new THREE.SphereGeometry(radius, 32, 32)
    const material = new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.3,
      roughness: 0.2,
      emissive: 0xffea00,
      emissiveIntensity: 0.3
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    return mesh
  }

  createBox(size = { x: 1, y: 1, z: 1 }, color = 0x1a237e, options = {}) {
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z)
    const material = new THREE.MeshStandardMaterial({
      color: color,
      metalness: options.metalness || 0.5,
      roughness: options.roughness || 0.3,
      emissive: options.emissive || 0x000000,
      emissiveIntensity: options.emissiveIntensity || 0
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  createCylinder(radius = 0.5, height = 1, color = 0xff1744, options = {}) {
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 32)
    const material = new THREE.MeshStandardMaterial({
      color: color,
      metalness: options.metalness || 0.7,
      roughness: options.roughness || 0.2,
      emissive: options.emissive || color,
      emissiveIntensity: options.emissiveIntensity || 0.5
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    return mesh
  }

  createPlane(size = { x: 10, z: 20 }, color = 0x2a2a4a) {
    const geometry = new THREE.PlaneGeometry(size.x, size.z)
    const material = new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.3,
      roughness: 0.5
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.receiveShadow = true
    return mesh
  }

  createScoreboard(initialScore = 0) {
    const geometry = new THREE.PlaneGeometry(4, 1.5)
    
    const material = new THREE.ShaderMaterial({
      uniforms: {
        score: { value: initialScore },
        backgroundColor: { value: new THREE.Color(0x0a0a2a) },
        textColor: { value: new THREE.Color(0xffea00) },
        glowColor: { value: new THREE.Color(0x00e5ff) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float score;
        uniform vec3 backgroundColor;
        uniform vec3 textColor;
        uniform vec3 glowColor;

        varying vec2 vUv;

        float sdSegment(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p - a, ba = b - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          return length(pa - ba * h);
        }

        float sdRect(vec2 p, vec2 size, float radius) {
          size -= radius;
          vec2 d = abs(p) - size;
          return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - radius;
        }

        float digit0(vec2 p) {
          float outer = sdRect(p, vec2(0.32, 0.42), 0.1);
          float inner = sdRect(p, vec2(0.18, 0.28), 0.06);
          return max(outer, -inner);
        }

        float digit1(vec2 p) {
          return sdSegment(p, vec2(0.0, -0.4), vec2(0.0, 0.4)) - 0.08;
        }

        float digit2(vec2 p) {
          float top = sdSegment(p, vec2(-0.25, 0.3), vec2(0.25, 0.3)) - 0.08;
          float mid = sdSegment(p, vec2(-0.25, 0.0), vec2(0.25, 0.0)) - 0.08;
          float bot = sdSegment(p, vec2(-0.25, -0.3), vec2(0.25, -0.3)) - 0.08;
          float tr = sdSegment(p, vec2(0.25, 0.3), vec2(0.25, 0.0)) - 0.08;
          float bl = sdSegment(p, vec2(-0.25, 0.0), vec2(-0.25, -0.3)) - 0.08;
          return min(min(min(min(top, mid), bot), tr), bl);
        }

        float digit3(vec2 p) {
          float top = sdSegment(p, vec2(-0.25, 0.3), vec2(0.25, 0.3)) - 0.08;
          float mid = sdSegment(p, vec2(-0.2, 0.0), vec2(0.2, 0.0)) - 0.08;
          float bot = sdSegment(p, vec2(-0.25, -0.3), vec2(0.25, -0.3)) - 0.08;
          float r1 = sdSegment(p, vec2(0.25, 0.3), vec2(0.25, 0.0)) - 0.08;
          float r2 = sdSegment(p, vec2(0.25, 0.0), vec2(0.25, -0.3)) - 0.08;
          return min(min(min(min(top, mid), bot), r1), r2);
        }

        float digit4(vec2 p) {
          float left = sdSegment(p, vec2(-0.25, 0.3), vec2(-0.25, 0.0)) - 0.08;
          float mid = sdSegment(p, vec2(-0.25, 0.0), vec2(0.25, 0.0)) - 0.08;
          float right = sdSegment(p, vec2(0.25, 0.4), vec2(0.25, -0.4)) - 0.08;
          return min(min(left, mid), right);
        }

        float digit5(vec2 p) {
          float top = sdSegment(p, vec2(-0.25, 0.3), vec2(0.25, 0.3)) - 0.08;
          float mid = sdSegment(p, vec2(-0.2, 0.0), vec2(0.2, 0.0)) - 0.08;
          float bot = sdSegment(p, vec2(-0.25, -0.3), vec2(0.25, -0.3)) - 0.08;
          float tl = sdSegment(p, vec2(-0.25, 0.3), vec2(-0.25, 0.0)) - 0.08;
          float br = sdSegment(p, vec2(0.25, 0.0), vec2(0.25, -0.3)) - 0.08;
          return min(min(min(min(top, mid), bot), tl), br);
        }

        float digit6(vec2 p) {
          float top = sdSegment(p, vec2(-0.25, 0.3), vec2(0.25, 0.3)) - 0.08;
          float mid = sdSegment(p, vec2(-0.2, 0.0), vec2(0.2, 0.0)) - 0.08;
          float bot = sdSegment(p, vec2(-0.25, -0.3), vec2(0.25, -0.3)) - 0.08;
          float tl = sdSegment(p, vec2(-0.25, 0.3), vec2(-0.25, 0.0)) - 0.08;
          float bl = sdSegment(p, vec2(-0.25, 0.0), vec2(-0.25, -0.3)) - 0.08;
          float br = sdSegment(p, vec2(0.25, 0.0), vec2(0.25, -0.3)) - 0.08;
          return min(min(min(min(min(top, mid), bot), tl), bl), br);
        }

        float digit7(vec2 p) {
          float top = sdSegment(p, vec2(-0.25, 0.3), vec2(0.25, 0.3)) - 0.08;
          float right = sdSegment(p, vec2(0.25, 0.3), vec2(0.25, -0.3)) - 0.08;
          return min(top, right);
        }

        float digit8(vec2 p) {
          float d = digit0(p);
          float mid = sdSegment(p, vec2(-0.2, 0.0), vec2(0.2, 0.0)) - 0.08;
          return min(d, mid);
        }

        float digit9(vec2 p) {
          float d = digit0(p);
          float mid = sdSegment(p, vec2(-0.2, 0.0), vec2(0.2, 0.0)) - 0.08;
          float bl = sdSegment(p, vec2(-0.25, 0.0), vec2(-0.25, -0.3)) - 0.08;
          return min(min(d, mid), bl);
        }

        float getDigit(vec2 p, float digit) {
          if (digit < 0.5) return digit0(p);
          else if (digit < 1.5) return digit1(p);
          else if (digit < 2.5) return digit2(p);
          else if (digit < 3.5) return digit3(p);
          else if (digit < 4.5) return digit4(p);
          else if (digit < 5.5) return digit5(p);
          else if (digit < 6.5) return digit6(p);
          else if (digit < 7.5) return digit7(p);
          else if (digit < 8.5) return digit8(p);
          else return digit9(p);
        }

        void main() {
          vec2 uv = vUv * 2.0 - 1.0;
          
          float border = sdRect(uv, vec2(0.95, 0.9), 0.12);
          float innerBorder = sdRect(uv, vec2(0.88, 0.83), 0.1);
          
          float scoreVal = score;
          float digitDist = 1.0;
          float digitSpacing = 0.3;
          float startX = -digitSpacing * 2.5;
          
          for (int i = 0; i < 6; i++) {
            float divisor = pow(10.0, float(5 - i));
            float d = floor(mod(scoreVal / divisor, 10.0));
            vec2 digitPos = vec2(startX + float(i) * digitSpacing, 0.0);
            vec2 localUv = (uv - digitPos) * vec2(1.0, 1.15);
            float digitSDF = getDigit(localUv, d);
            
            float showDigit = 1.0;
            if (i < 5) {
              float threshold = pow(10.0, float(5 - i));
              showDigit = step(threshold - 0.5, scoreVal);
              if (i == 0 && scoreVal < 10.0) showDigit = 0.0;
            }
            
            digitSDF = mix(1.0, digitSDF, showDigit);
            digitDist = min(digitDist, digitSDF);
          }
          
          float finalDist = min(max(border, -innerBorder), digitDist);
          
          float glow = exp(-finalDist * 10.0) * 0.6;
          float outline = smoothstep(0.03, -0.01, finalDist);
          float fill = smoothstep(0.0, -0.025, finalDist);
          
          vec3 col = backgroundColor;
          col += glow * glowColor;
          col = mix(col, textColor, outline * 0.4);
          col = mix(col, textColor + glowColor * 0.4, fill);
          
          float alpha = smoothstep(0.15, -0.02, finalDist);
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    })

    const mesh = new THREE.Mesh(geometry, material)
    return mesh
  }

  onResize() {
    const { clientWidth, clientHeight } = this.container
    this.camera.aspect = clientWidth / clientHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(clientWidth, clientHeight)
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
