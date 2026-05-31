import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { Level } from 'level'
import { v4 as uuidv4 } from 'uuid'

const db = new Level('./data/db', { valueEncoding: 'binary' })
const wss = new WebSocketServer({ port: 1234 })

const docs = new Map()
const clients = new Map()

async function loadDoc(docId) {
  if (docs.has(docId)) {
    return docs.get(docId)
  }

  const ydoc = new Y.Doc()
  
  try {
    const data = await db.get(`doc:${docId}`)
    if (data) {
      Y.applyUpdate(ydoc, data)
    }
  } catch (e) {
    console.log(`New document: ${docId}`)
  }

  ydoc.on('update', async (update, origin) => {
    if (origin !== 'server') {
      const state = Y.encodeStateAsUpdate(ydoc)
      await db.put(`doc:${docId}`, state)
      
      clients.forEach((client) => {
        if (client.docId === docId && client.ws.readyState === 1) {
          client.ws.send(JSON.stringify({
            type: 'update',
            docId,
            update: Array.from(update)
          }))
        }
      })
    }
  })

  docs.set(docId, ydoc)
  return ydoc
}

wss.on('connection', (ws) => {
  const clientId = uuidv4()
  console.log(`Client connected: ${clientId}`)

  clients.set(clientId, {
    ws,
    docId: null,
    lastSeen: Date.now()
  })

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString())
      const client = clients.get(clientId)
      
      if (!client) return
      client.lastSeen = Date.now()

      switch (message.type) {
        case 'sync': {
          const { docId, updates } = message
          client.docId = docId
          
          const ydoc = await loadDoc(docId)
          
          if (updates && updates.length > 0) {
            for (const update of updates) {
              Y.applyUpdate(ydoc, new Uint8Array(update), 'server')
            }
          }
          
          const state = Y.encodeStateAsUpdate(ydoc)
          ws.send(JSON.stringify({
            type: 'sync-response',
            docId,
            update: Array.from(state)
          }))
          break
        }

        case 'update': {
          const { docId, update } = message
          const ydoc = await loadDoc(docId)
          Y.applyUpdate(ydoc, new Uint8Array(update), 'server')
          break
        }

        case 'get-all-notes': {
          const noteIds = []
          for await (const key of db.keys()) {
            if (key.startsWith('doc:')) {
              noteIds.push(key.replace('doc:', ''))
            }
          }
          
          const notes = []
          for (const noteId of noteIds) {
            const ydoc = await loadDoc(noteId)
            const title = ydoc.getText('title').toString()
            const content = ydoc.getText('content').toString()
            const lastModified = ydoc.getMap('meta').get('lastModified') || 0
            
            notes.push({
              id: parseInt(noteId),
              title: title || '无标题',
              content: content || '',
              last_modified: new Date(lastModified).toISOString()
            })
          }
          
          ws.send(JSON.stringify({
            type: 'all-notes',
            notes
          }))
          break
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }))
          break
        }
      }
    } catch (error) {
      console.error('Error processing message:', error)
    }
  })

  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`)
    clients.delete(clientId)
  })

  ws.on('error', (error) => {
    console.error(`Client error ${clientId}:`, error)
  })
})

setInterval(() => {
  const now = Date.now()
  clients.forEach((client, id) => {
    if (now - client.lastSeen > 60000) {
      console.log(`Timeout client: ${id}`)
      client.ws.terminate()
      clients.delete(id)
    }
  })
}, 10000)

console.log('Sync server running on ws://localhost:1234')
console.log('Press Ctrl+C to stop')
