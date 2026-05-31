const CHUNK_SIZE = 16

class SeededRandom {
  constructor(seed) {
    this.seed = seed >>> 0
  }

  next() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 0x100000000
  }

  range(min, max) {
    return min + this.next() * (max - min)
  }

  int(min, max) {
    return Math.floor(this.range(min, max + 1))
  }
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = (h ^ (h >> 13)) * 1274126177
  h = h ^ (h >> 16)
  return ((h >>> 0) % 1000) / 1000
}

function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = x0 + 1
  const y1 = y0 + 1

  const sx = smoothstep(x - x0)
  const sy = smoothstep(y - y0)

  const n00 = hash2(x0, y0, seed)
  const n10 = hash2(x1, y0, seed)
  const n01 = hash2(x0, y1, seed)
  const n11 = hash2(x1, y1, seed)

  const nx0 = n00 + sx * (n10 - n00)
  const nx1 = n01 + sx * (n11 - n01)

  return nx0 + sy * (nx1 - nx0)
}

function fbm2D(x, y, seed, octaves = 4) {
  let value = 0
  let amplitude = 1
  let frequency = 1
  let maxValue = 0

  for (let i = 0; i < octaves; i++) {
    value += amplitude * valueNoise2D(x * frequency, y * frequency, seed + i * 1000)
    maxValue += amplitude
    amplitude *= 0.5
    frequency *= 2
  }

  return value / maxValue
}

export function generateTerrain(seedStr, options = {}) {
  const seed = seedStr ? cyrb53(seedStr) : Math.floor(Math.random() * 1000000)
  const rng = new SeededRandom(seed)

  const {
    scale = 3,
    heightMultiplier = 10,
    waterLevel = 4,
    mountainHeight = 8,
    riverWidth = 1,
    generateRivers = true
  } = options

  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE)

  const heightMap = new Array(CHUNK_SIZE)
  for (let x = 0; x < CHUNK_SIZE; x++) {
    heightMap[x] = new Array(CHUNK_SIZE)
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const nx = x / scale
      const nz = z / scale
      const noiseVal = fbm2D(nx, nz, seed, 4)

      const distFromCenter = Math.sqrt(Math.pow(x - CHUNK_SIZE / 2, 2) + Math.pow(z - CHUNK_SIZE / 2, 2))
      const edgeFactor = Math.max(0, 1 - distFromCenter / (CHUNK_SIZE / 2))

      let baseHeight = noiseVal * heightMultiplier
      if (noiseVal > 0.65) {
        baseHeight += (noiseVal - 0.65) * mountainHeight * 2
      }
      baseHeight = baseHeight * (0.5 + 0.5 * edgeFactor)

      heightMap[x][z] = Math.max(1, Math.min(CHUNK_SIZE - 2, Math.floor(baseHeight + 2)))
    }
  }

  const rivers = []
  if (generateRivers && CHUNK_SIZE >= 10) {
    const riverCount = rng.int(1, 3)
    for (let i = 0; i < riverCount; i++) {
      const river = generateRiver(rng, heightMap)
      rivers.push(river)
    }
  }

  const riverMap = new Array(CHUNK_SIZE)
  for (let x = 0; x < CHUNK_SIZE; x++) {
    riverMap[x] = new Array(CHUNK_SIZE).fill(false)
  }
  for (const river of rivers) {
    for (const point of river) {
      for (let dx = -riverWidth; dx <= riverWidth; dx++) {
        for (let dz = -riverWidth; dz <= riverWidth; dz++) {
          const rx = Math.floor(point.x + dx)
          const rz = Math.floor(point.z + dz)
          if (rx >= 0 && rx < CHUNK_SIZE && rz >= 0 && rz < CHUNK_SIZE) {
            if (dx * dx + dz * dz <= riverWidth * riverWidth) {
              riverMap[rx][rz] = true
            }
          }
        }
      }
    }
  }

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const height = heightMap[x][z]
      const isRiver = riverMap[x][z]

      for (let y = 0; y < CHUNK_SIZE; y++) {
        const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE

        if (y <= height) {
          if (isRiver && y <= waterLevel + 1 && y >= waterLevel - 1) {
            data[index] = 21
          } else if (y === height) {
            if (height > waterLevel + 2) {
              data[index] = 44
            } else if (height > waterLevel) {
              data[index] = 3
            } else {
              data[index] = 5
            }
          } else if (y >= height - 2) {
            if (height > waterLevel + 2) {
              data[index] = 45
            } else {
              data[index] = 6
            }
          } else if (y <= 2) {
            data[index] = 58
          } else {
            data[index] = 6
          }
        } else if (isRiver && y <= waterLevel && y > height) {
          data[index] = 21
        }
      }
    }
  }

  if (rng.next() > 0.5) {
    addTrees(rng, data, heightMap, waterLevel, riverMap)
  }

  return btoa(String.fromCharCode.apply(null, data))
}

function generateRiver(rng, heightMap) {
  const river = []
  const startEdge = rng.int(0, 3)
  let x, z

  switch (startEdge) {
    case 0:
      x = rng.int(2, CHUNK_SIZE - 3)
      z = 0
      break
    case 1:
      x = CHUNK_SIZE - 1
      z = rng.int(2, CHUNK_SIZE - 3)
      break
    case 2:
      x = rng.int(2, CHUNK_SIZE - 3)
      z = CHUNK_SIZE - 1
      break
    default:
      x = 0
      z = rng.int(2, CHUNK_SIZE - 3)
  }

  const targetX = rng.int(4, CHUNK_SIZE - 5)
  const targetZ = rng.int(4, CHUNK_SIZE - 5)

  let currentX = x
  let currentZ = z

  for (let step = 0; step < 50; step++) {
    river.push({ x: currentX, z: currentZ })

    const dx = targetX - currentX
    const dz = targetZ - currentZ
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < 1) break

    const dirX = dx / dist
    const dirZ = dz / dist

    const noiseX = (rng.next() - 0.5) * 0.8
    const noiseZ = (rng.next() - 0.5) * 0.8

    currentX += dirX + noiseX
    currentZ += dirZ + noiseZ

    currentX = Math.max(0, Math.min(CHUNK_SIZE - 1, currentX))
    currentZ = Math.max(0, Math.min(CHUNK_SIZE - 1, currentZ))
  }

  return river
}

function addTrees(rng, data, heightMap, waterLevel, riverMap) {
  const treeCount = rng.int(2, 6)
  let placed = 0
  let attempts = 0

  while (placed < treeCount && attempts < 50) {
    attempts++
    const x = rng.int(2, CHUNK_SIZE - 3)
    const z = rng.int(2, CHUNK_SIZE - 3)

    if (riverMap[x][z]) continue

    const height = heightMap[x][z]
    if (height <= waterLevel + 1) continue
    if (height > CHUNK_SIZE - 6) continue

    const treeHeight = rng.int(3, 5)

    let canPlace = true
    for (let y = height + 1; y <= height + treeHeight + 2; y++) {
      const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE
      if (data[index] !== 0) {
        canPlace = false
        break
      }
    }
    if (!canPlace) continue

    for (let y = height + 1; y <= height + treeHeight; y++) {
      const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE
      data[index] = 46
    }

    const leafStart = height + treeHeight - 1
    const leafEnd = height + treeHeight + 2
    for (let y = leafStart; y <= leafEnd; y++) {
      const radius = y === leafEnd ? 1 : (y === leafStart ? 2 : 2)
      for (let lx = -radius; lx <= radius; lx++) {
        for (let lz = -radius; lz <= radius; lz++) {
          if (lx * lx + lz * lz <= radius * radius) {
            const tx = x + lx
            const tz = z + lz
            if (tx >= 0 && tx < CHUNK_SIZE && tz >= 0 && tz < CHUNK_SIZE) {
              const index = tx + y * CHUNK_SIZE + tz * CHUNK_SIZE * CHUNK_SIZE
              if (data[index] === 0) {
                data[index] = 4
              }
            }
          }
        }
      }
    }

    placed++
  }
}

function cyrb53(str) {
  let h1 = 0xdeadbeef ^ 0
  let h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}
