import * as Y from 'yjs'
import { Note } from './types'

const SYNC_SERVER_URL = 'ws://localhost:1234'

class SyncService {
  private ws: WebSocket | null = null
  private docs: Map<number, Y.Doc> = new Map()
  private pendingUpdates: Map<number, Uint8Array[]> = new Map()
  private reconnectTimer: number | null = null
  private isOnline: boolean = false
  private onStatusChange: ((online: boolean) => void) | null = null

  constructor() {
    this.connect()
  }

  setStatusCallback(callback: (online: boolean) => void) {
    this.onStatusChange = callback
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  private connect() {
    try {
      this.ws = new WebSocket(SYNC_SERVER_URL)

      this.ws.onopen = () => {
        console.log('Connected to sync server')
        this.isOnline = true
        this.onStatusChange?.(true)
        this.flushPendingUpdates()
      }

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          this.handleMessage(message)
        } catch (error) {
          console.error('Failed to parse message:', error)
        }
      }

      this.ws.onclose = () => {
        console.log('Disconnected from sync server')
        this.isOnline = false
        this.onStatusChange?.(false)
        this.scheduleReconnect()
      }

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error)
      }
    } catch (error) {
      console.error('Failed to connect:', error)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    this.reconnectTimer = setTimeout(() => {
      console.log('Reconnecting to sync server...')
      this.connect()
    }, 3000) as unknown as number
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case 'sync-response': {
        const doc = this.docs.get(parseInt(message.docId))
        if (doc && message.update) {
          Y.applyUpdate(doc, new Uint8Array(message.update))
        }
        break
      }
      case 'update': {
        const doc = this.docs.get(parseInt(message.docId))
        if (doc && message.update) {
          Y.applyUpdate(doc, new Uint8Array(message.update))
        }
        break
      }
      case 'all-notes': {
        break
      }
      case 'pong': {
        break
      }
    }
  }

  private flushPendingUpdates() {
    this.pendingUpdates.forEach((updates, docId) => {
      if (updates.length > 0) {
        this.sendSync(docId, updates)
      }
    })
    this.pendingUpdates.clear()
  }

  getDoc(noteId: number): Y.Doc {
    if (!this.docs.has(noteId)) {
      const ydoc = new Y.Doc()
      
      ydoc.on('update', (update: Uint8Array, origin: any) => {
        if (origin !== 'remote') {
          this.sendUpdate(noteId, update)
        }
      })

      this.docs.set(noteId, ydoc)
      
      if (this.isConnected()) {
        this.sendSync(noteId, [])
      }
    }
    return this.docs.get(noteId)!
  }

  initializeNote(note: Note): Y.Doc {
    const ydoc = this.getDoc(note.id)
    const ytitle = ydoc.getText('title')
    const ycontent = ydoc.getText('content')
    const ymeta = ydoc.getMap('meta')

    if (ytitle.length === 0 && note.title) {
      ytitle.insert(0, note.title)
    }
    if (ycontent.length === 0 && note.content) {
      ycontent.insert(0, note.content)
    }
    
    ymeta.set('lastModified', Date.now())

    return ydoc
  }

  private sendSync(docId: number, updates: Uint8Array[]) {
    if (!this.isConnected()) {
      const pending = this.pendingUpdates.get(docId) || []
      this.pendingUpdates.set(docId, [...pending, ...updates])
      return
    }

    this.ws?.send(JSON.stringify({
      type: 'sync',
      docId: docId.toString(),
      updates: updates.map(u => Array.from(u))
    }))
  }

  private sendUpdate(docId: number, update: Uint8Array) {
    if (!this.isConnected()) {
      const pending = this.pendingUpdates.get(docId) || []
      this.pendingUpdates.set(docId, [...pending, update])
      return
    }

    this.ws?.send(JSON.stringify({
      type: 'update',
      docId: docId.toString(),
      update: Array.from(update)
    }))
  }

  syncAllNotes(notes: Note[]) {
    notes.forEach(note => {
      const ydoc = this.initializeNote(note)
      this.sendSync(note.id, [])
    })
  }

  dispose() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    this.ws?.close()
    this.docs.forEach(doc => doc.destroy())
    this.docs.clear()
  }
}

export const syncService = new SyncService()
