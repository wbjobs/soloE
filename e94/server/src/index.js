import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import staticPlugin from '@fastify/static'
import multipart from '@fastify/multipart'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import sharp from 'sharp'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const prisma = new PrismaClient()
const fastify = Fastify({ logger: true })

fastify.register(cors, { origin: '*' })
fastify.register(websocket)
fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

const uploadsDir = path.join(__dirname, '..', 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

fastify.register(staticPlugin, {
  root: uploadsDir,
  prefix: '/uploads/'
})

const players = new Map()
const crdtStates = new Map()

const CHUNK_SIZE = 16
const VOXEL_COUNT = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE

function getDefaultCRDTState() {
  const timestamps = new BigUint64Array(VOXEL_COUNT)
  const values = new Uint8Array(VOXEL_COUNT)
  return { timestamps, values }
}

function serializeCRDTState(state) {
  const tsBuffer = Buffer.from(state.timestamps.buffer)
  const valBuffer = Buffer.from(state.values.buffer)
  return tsBuffer.toString('base64') + '|' + valBuffer.toString('base64')
}

function deserializeCRDTState(serialized) {
  if (!serialized || !serialized.includes('|')) {
    return getDefaultCRDTState()
  }
  const [tsB64, valB64] = serialized.split('|')
  const tsBuffer = Buffer.from(tsB64, 'base64')
  const valBuffer = Buffer.from(valB64, 'base64')
  const timestamps = new BigUint64Array(tsBuffer.buffer, tsBuffer.byteOffset, VOXEL_COUNT)
  const values = new Uint8Array(valBuffer.buffer, valBuffer.byteOffset, VOXEL_COUNT)
  return { timestamps, values }
}

function applyVoxelOperation(state, x, y, z, value, timestamp) {
  const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE
  const existingTs = state.timestamps[index]
  const newTs = BigInt(timestamp)

  if (newTs > existingTs) {
    state.timestamps[index] = newTs
    state.values[index] = value
    return true
  }
  return false
}

function getVoxelDataFromCRDT(state) {
  return Buffer.from(state.values.buffer).toString('base64')
}

function voxelDataToBase64(values) {
  return Buffer.from(values.buffer).toString('base64')
}

const workSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  thumbnail: z.string().optional(),
  crdtState: z.string().optional(),
  voxelData: z.string().optional(),
  userId: z.string().uuid()
})

const userSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
})

fastify.post('/api/users', async (request, reply) => {
  try {
    const { name, color } = userSchema.parse(request.body)
    const user = await prisma.user.create({ data: { name, color } })
    return user
  } catch (e) {
    return reply.status(400).send({ error: e.message })
  }
})

fastify.post('/api/works/:id/thumbnail', async (request, reply) => {
  try {
    const workId = request.params.id
    const data = await request.file()

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' })
    }

    const fileBuffer = await data.toBuffer()

    const filename = `${workId}_${crypto.randomUUID()}.png`
    const filepath = path.join(uploadsDir, filename)

    await sharp(fileBuffer)
      .resize(200, 200, {
        fit: 'contain',
        background: { r: 10, g: 10, b: 20, alpha: 1 }
      })
      .png({ quality: 80 })
      .toFile(filepath)

    const thumbnailUrl = `/uploads/${filename}`

    await prisma.work.update({
      where: { id: workId },
      data: { thumbnail: thumbnailUrl }
    })

    return { success: true, thumbnail: thumbnailUrl }
  } catch (e) {
    console.error('Thumbnail upload error:', e)
    return reply.status(500).send({ error: e.message })
  }
})

fastify.get('/api/works', async () => {
  const works = await prisma.work.findMany({
    include: { user: { select: { id: true, name: true, color: true } } },
    orderBy: { updatedAt: 'desc' }
  })
  return works
})

fastify.get('/api/works/:id', async (request, reply) => {
  const work = await prisma.work.findUnique({
    where: { id: request.params.id },
    include: { user: { select: { id: true, name: true, color: true } } }
  })
  if (!work) return reply.status(404).send({ error: 'Work not found' })
  return work
})

fastify.post('/api/works', async (request, reply) => {
  try {
    const data = workSchema.parse(request.body)
    const workData = {
      title: data.title,
      description: data.description,
      thumbnail: data.thumbnail,
      voxelData: data.voxelData || getVoxelDataFromCRDT(getDefaultCRDTState()),
      crdtState: data.crdtState || serializeCRDTState(getDefaultCRDTState()),
      userId: data.userId
    }
    const work = await prisma.work.create({ data: workData })
    return work
  } catch (e) {
    return reply.status(400).send({ error: e.message })
  }
})

fastify.put('/api/works/:id', async (request, reply) => {
  try {
    const { title, description, thumbnail, voxelData, crdtState } = workSchema.omit({ userId: true }).parse(request.body)
    const updateData = { title, description }
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail
    if (voxelData !== undefined) updateData.voxelData = voxelData
    if (crdtState !== undefined) updateData.crdtState = crdtState

    const work = await prisma.work.update({
      where: { id: request.params.id },
      data: updateData
    })
    return work
  } catch (e) {
    return reply.status(400).send({ error: e.message })
  }
})

fastify.delete('/api/works/:id', async (request, reply) => {
  await prisma.work.delete({ where: { id: request.params.id } })
  return { success: true }
})

fastify.register(async (fastify) => {
  fastify.get('/ws', { websocket: true }, async (connection, req) => {
    const url = new URL(req.url, 'http://localhost')
    const workId = url.searchParams.get('workId')
    const userId = url.searchParams.get('userId')
    const userName = url.searchParams.get('userName') || 'Anonymous'
    const userColor = url.searchParams.get('userColor') || '#ff0000'

    if (!workId || !userId) {
      connection.socket.close()
      return
    }

    if (!crdtStates.has(workId)) {
      try {
        const work = await prisma.work.findUnique({ where: { id: workId } })
        if (work && work.crdtState) {
          crdtStates.set(workId, deserializeCRDTState(work.crdtState))
        } else {
          crdtStates.set(workId, getDefaultCRDTState())
        }
      } catch (e) {
        crdtStates.set(workId, getDefaultCRDTState())
      }
    }

    const player = {
      id: userId,
      name: userName,
      color: userColor,
      socket: connection.socket,
      position: { x: 0, y: 0, z: 0 }
    }

    if (!players.has(workId)) {
      players.set(workId, new Map())
    }
    players.get(workId).set(userId, player)

    const state = crdtStates.get(workId)
    const voxelData = getVoxelDataFromCRDT(state)

    const playerList = Array.from(players.get(workId).values()).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      position: p.position
    }))

    connection.socket.send(JSON.stringify({
      type: 'init',
      voxelData,
      crdtState: serializeCRDTState(state),
      players: playerList
    }))

    broadcastToWork(workId, {
      type: 'playerJoin',
      player: { id: userId, name: userName, color: userColor, position: player.position }
    }, userId)

    connection.socket.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString())

        if (data.type === 'setVoxel') {
          const { x, y, z, value, timestamp } = data
          if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return

          const state = crdtStates.get(workId)
          const applied = applyVoxelOperation(state, x, y, z, value, timestamp)

          if (applied) {
            broadcastToWork(workId, {
              type: 'voxelUpdate',
              x, y, z, value, timestamp,
              userId
            })

            prisma.work.update({
              where: { id: workId },
              data: {
                voxelData: getVoxelDataFromCRDT(state),
                crdtState: serializeCRDTState(state)
              }
            }).catch(e => console.error('Failed to persist voxel update:', e))
          }
        } else if (data.type === 'playerMove') {
          const { position } = data
          player.position = position
          broadcastToWork(workId, {
            type: 'playerMove',
            playerId: userId,
            position
          }, userId)
        } else if (data.type === 'crdtSync') {
          const { operations } = data
          if (!Array.isArray(operations)) return

          const state = crdtStates.get(workId)
          const appliedOps = []

          for (const op of operations) {
            const { x, y, z, value, timestamp } = op
            if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) continue

            if (applyVoxelOperation(state, x, y, z, value, timestamp)) {
              appliedOps.push(op)
            }
          }

          if (appliedOps.length > 0) {
            for (const op of appliedOps) {
              broadcastToWork(workId, {
                type: 'voxelUpdate',
                ...op,
                userId
              })
            }

            prisma.work.update({
              where: { id: workId },
              data: {
                voxelData: getVoxelDataFromCRDT(state),
                crdtState: serializeCRDTState(state)
              }
            }).catch(e => console.error('Failed to persist CRDT sync:', e))
          }
        }
      } catch (e) {
        console.error('WebSocket message error:', e)
      }
    })

    connection.socket.on('close', () => {
      const workPlayers = players.get(workId)
      if (workPlayers) {
        workPlayers.delete(userId)
        broadcastToWork(workId, {
          type: 'playerLeave',
          playerId: userId
        })
        if (workPlayers.size === 0) {
          players.delete(workId)
        }
      }
    })
  })
})

function broadcastToWork(workId, message, excludeUserId = null) {
  const workPlayers = players.get(workId)
  if (!workPlayers) return

  const msg = JSON.stringify(message)
  for (const [id, player] of workPlayers) {
    if (id !== excludeUserId && player.socket.readyState === 1) {
      player.socket.send(msg)
    }
  }
}

const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' })
    console.log('Server running on http://localhost:3001')
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
