class LayoutEngine {
  constructor(sceneManager) {
    this.sceneManager = sceneManager
    this.CORRIDOR_WIDTH = 0.6
    this.WALL_CLEARANCE = 0.15
    this.iterations = 200
  }

  calculateLayout(furnitureTypes, roomConfig) {
    const furnitureList = furnitureTypes.map((type, index) => {
      const dims = this.getFurnitureDimensions(type)
      return {
        type,
        id: index,
        x: 0,
        z: 0,
        rotation: 0,
        width: dims.width,
        depth: dims.depth,
        vx: 0,
        vz: 0,
        boundingBox: null
      }
    })

    this.initializePositions(furnitureList, roomConfig)
    this.updateAllBoundingBoxes(furnitureList)

    for (let i = 0; i < this.iterations; i++) {
      this.applyCollisionForces(furnitureList, roomConfig)
      this.applyWallAttraction(furnitureList, roomConfig)
      this.applyRotationAlignment(furnitureList, roomConfig)
      this.enforceBoundaries(furnitureList, roomConfig)
      this.enforceCorridors(furnitureList, roomConfig)
      
      this.updateAllBoundingBoxes(furnitureList)
    }

    this.finalizeWallAttachment(furnitureList, roomConfig)
    this.updateAllBoundingBoxes(furnitureList)
    this.resolveAllCollisions(furnitureList, roomConfig)

    return furnitureList
  }

  getFurnitureDimensions(type) {
    const dimensions = {
      sofa: { width: 2.2, depth: 0.9 },
      bed: { width: 1.8, depth: 2.2 },
      table: { width: 1.4, depth: 0.8 },
      chair: { width: 0.5, depth: 0.5 },
      cabinet: { width: 1.2, depth: 0.45 }
    }
    return dimensions[type] || { width: 1, depth: 1 }
  }

  initializePositions(furnitureList, roomConfig) {
    const { width, depth } = roomConfig
    const centerX = width / 2
    const centerZ = depth / 2

    furnitureList.forEach((furniture, index) => {
      const angle = (index / furnitureList.length) * Math.PI * 2
      const radius = Math.min(width, depth) * 0.3
      furniture.x = centerX + Math.cos(angle) * radius
      furniture.z = centerZ + Math.sin(angle) * radius
    })
  }

  getRotatedCorners(furniture) {
    const { x, z, width, depth, rotation } = furniture
    const hw = width / 2
    const hd = depth / 2
    
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    
    const corners = [
      { x: -hw, z: -hd },
      { x: hw, z: -hd },
      { x: hw, z: hd },
      { x: -hw, z: hd }
    ]
    
    return corners.map(c => ({
      x: x + c.x * cos - c.z * sin,
      z: z + c.x * sin + c.z * cos
    }))
  }

  getAABB(furniture) {
    const corners = this.getRotatedCorners(furniture)
    const xs = corners.map(c => c.x)
    const zs = corners.map(c => c.z)
    
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
      width: Math.max(...xs) - Math.min(...xs),
      depth: Math.max(...zs) - Math.min(...zs)
    }
  }

  updateAllBoundingBoxes(furnitureList) {
    furnitureList.forEach(furniture => {
      furniture.boundingBox = this.getAABB(furniture)
    })
  }

  getAxes(furniture) {
    const { rotation } = furniture
    return [
      { x: Math.cos(rotation), z: Math.sin(rotation) },
      { x: -Math.sin(rotation), z: Math.cos(rotation) }
    ]
  }

  projectOntoAxis(corners, axis) {
    const projections = corners.map(c => c.x * axis.x + c.z * axis.z)
    return { min: Math.min(...projections), max: Math.max(...projections) }
  }

  overlapOnAxis(projA, projB) {
    return projA.min < projB.max && projB.min < projA.max
  }

  getOverlapDepth(projA, projB) {
    return Math.min(projA.max, projB.max) - Math.max(projA.min, projB.min)
  }

  satCollision(a, b) {
    const cornersA = this.getRotatedCorners(a)
    const cornersB = this.getRotatedCorners(b)
    
    const axesA = this.getAxes(a)
    const axesB = this.getAxes(b)
    const allAxes = [...axesA, ...axesB]
    
    let minOverlap = Infinity
    let minAxis = null
    
    for (const axis of allAxes) {
      const projA = this.projectOntoAxis(cornersA, axis)
      const projB = this.projectOntoAxis(cornersB, axis)
      
      if (!this.overlapOnAxis(projA, projB)) {
        return { collided: false }
      }
      
      const overlap = this.getOverlapDepth(projA, projB)
      if (overlap < minOverlap) {
        minOverlap = overlap
        minAxis = axis
      }
    }
    
    return {
      collided: true,
      overlap: minOverlap,
      axis: minAxis
    }
  }

  applyCollisionForces(furnitureList, roomConfig) {
    const repulsionStrength = 0.8
    const damping = 0.7

    for (let i = 0; i < furnitureList.length; i++) {
      for (let j = i + 1; j < furnitureList.length; j++) {
        const a = furnitureList[i]
        const b = furnitureList[j]

        const dx = b.x - a.x
        const dz = b.z - a.z
        const dist = Math.sqrt(dx * dx + dz * dz)

        if (dist < 0.01) continue

        const collision = this.satCollision(a, b)
        
        if (collision.collided) {
          const overlap = collision.overlap
          const force = repulsionStrength * (overlap + 0.3)
          
          const nx = dx / dist
          const nz = dz / dist
          
          const fx = nx * force
          const fz = nz * force

          a.vx -= fx
          a.vz -= fz
          b.vx += fx
          b.vz += fz
        } else if (dist < this.CORRIDOR_WIDTH) {
          const force = repulsionStrength * 0.2 / Math.max(dist, 0.1)
          const fx = (dx / dist) * force
          const fz = (dz / dist) * force

          a.vx -= fx
          a.vz -= fz
          b.vx += fx
          b.vz += fz
        }
      }
    }

    furnitureList.forEach(furniture => {
      furniture.x += furniture.vx
      furniture.z += furniture.vz
      furniture.vx *= damping
      furniture.vz *= damping
    })
  }

  applyWallAttraction(furnitureList, roomConfig) {
    const { width, depth } = roomConfig
    const attractionStrength = 0.08

    const wallAttachedTypes = ['cabinet', 'sofa', 'bed']

    furnitureList.forEach(furniture => {
      if (!wallAttachedTypes.includes(furniture.type)) return
      if (!furniture.boundingBox) return

      const { minX, maxX, minZ, maxZ } = furniture.boundingBox

      const distances = [
        { wall: 'left', dist: minX, normal: { x: 1, z: 0 } },
        { wall: 'right', dist: width - maxX, normal: { x: -1, z: 0 } },
        { wall: 'front', dist: minZ, normal: { x: 0, z: 1 } },
        { wall: 'back', dist: depth - maxZ, normal: { x: 0, z: -1 } }
      ]

      const nearestWall = distances.reduce((min, d) => d.dist < min.dist ? d : min)

      if (nearestWall.dist < 2.5 && nearestWall.dist > 0.1) {
        const force = attractionStrength * Math.min(2.5 - nearestWall.dist, 0.5)
        furniture.vx += nearestWall.normal.x * force
        furniture.vz += nearestWall.normal.z * force
      }
    })
  }

  applyRotationAlignment(furnitureList, roomConfig) {
    const { width, depth } = roomConfig

    furnitureList.forEach(furniture => {
      let targetRotation = furniture.rotation

      if (furniture.type === 'sofa' || furniture.type === 'cabinet') {
        const distToSideWalls = Math.min(furniture.x, width - furniture.x)
        const distToFrontBack = Math.min(furniture.z, depth - furniture.z)

        if (distToSideWalls < distToFrontBack) {
          targetRotation = Math.PI / 2
        } else {
          targetRotation = 0
        }
      } else if (furniture.type === 'bed') {
        targetRotation = 0
      }

      const rotDiff = targetRotation - furniture.rotation
      const normalizedDiff = Math.atan2(Math.sin(rotDiff), Math.cos(rotDiff))
      furniture.rotation += normalizedDiff * 0.08
    })
  }

  enforceBoundaries(furnitureList, roomConfig) {
    const { width, depth } = roomConfig

    furnitureList.forEach(furniture => {
      if (!furniture.boundingBox) return
      
      const { minX, maxX, minZ, maxZ } = furniture.boundingBox
      const padding = this.WALL_CLEARANCE

      if (minX < padding) {
        furniture.x += (padding - minX)
        furniture.vx *= 0.5
      }
      if (maxX > width - padding) {
        furniture.x -= (maxX - (width - padding))
        furniture.vx *= 0.5
      }
      if (minZ < padding) {
        furniture.z += (padding - minZ)
        furniture.vz *= 0.5
      }
      if (maxZ > depth - padding) {
        furniture.z -= (maxZ - (depth - padding))
        furniture.vz *= 0.5
      }
    })
  }

  enforceCorridors(furnitureList, roomConfig) {
    const { width, depth } = roomConfig
    const centerX = width / 2
    const centerZ = depth / 2

    furnitureList.forEach(furniture => {
      const dx = furniture.x - centerX
      const dz = furniture.z - centerZ
      const distFromCenter = Math.sqrt(dx * dx + dz * dz)

      if (distFromCenter > 0.5) {
        const pushForce = 0.015 * (distFromCenter - 0.5)
        furniture.x -= (dx / distFromCenter) * pushForce
        furniture.z -= (dz / distFromCenter) * pushForce
      }
    })
  }

  finalizeWallAttachment(furnitureList, roomConfig) {
    const { width, depth } = roomConfig
    const clearance = 0.2

    furnitureList.forEach(furniture => {
      const corners = this.getRotatedCorners(furniture)
      const xs = corners.map(c => c.x)
      const zs = corners.map(c => c.z)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minZ = Math.min(...zs)
      const maxZ = Math.max(...zs)

      const distToLeft = minX
      const distToRight = width - maxX
      const distToFront = minZ
      const distToBack = depth - maxZ

      const minDist = Math.min(distToLeft, distToRight, distToFront, distToBack)

      if (minDist < 1.5) {
        if (minDist === distToLeft) {
          furniture.x += (clearance - distToLeft)
          if (furniture.type === 'sofa' || furniture.type === 'cabinet') {
            furniture.rotation = Math.PI / 2
          }
        } else if (minDist === distToRight) {
          furniture.x -= (distToRight - clearance)
          if (furniture.type === 'sofa' || furniture.type === 'cabinet') {
            furniture.rotation = -Math.PI / 2
          }
        } else if (minDist === distToFront) {
          furniture.z += (clearance - distToFront)
          furniture.rotation = 0
        } else if (minDist === distToBack) {
          furniture.z -= (distToBack - clearance)
          furniture.rotation = Math.PI
        }
      }
    })
  }

  resolveAllCollisions(furnitureList, roomConfig) {
    let resolved = false
    let attempts = 0
    const maxAttempts = 50

    while (!resolved && attempts < maxAttempts) {
      resolved = true
      this.updateAllBoundingBoxes(furnitureList)

      for (let i = 0; i < furnitureList.length; i++) {
        for (let j = i + 1; j < furnitureList.length; j++) {
          const a = furnitureList[i]
          const b = furnitureList[j]

          const collision = this.satCollision(a, b)
          if (collision.collided) {
            resolved = false
            const dx = b.x - a.x
            const dz = b.z - a.z
            const dist = Math.sqrt(dx * dx + dz * dz) || 0.01

            const pushDist = collision.overlap * 0.55
            a.x -= (dx / dist) * pushDist
            a.z -= (dz / dist) * pushDist
            b.x += (dx / dist) * pushDist
            b.z += (dz / dist) * pushDist
          }
        }
      }

      this.enforceBoundaries(furnitureList, roomConfig)
      attempts++
    }
  }
}

export default LayoutEngine
