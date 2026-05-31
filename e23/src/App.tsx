import { useState, useEffect, useCallback } from 'preact/hooks'
import NoteList from './components/NoteList'
import MarkdownEditor from './components/MarkdownEditor'
import { Note } from './types'
import { getNotes, createNote, updateNote, deleteNote } from './api'
import { backupNote } from './backup'
import { syncService } from './sync'
import './App.css'

export default function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(false)

  useEffect(() => {
    loadNotes()
    
    syncService.setStatusCallback((online) => {
      setIsOnline(online)
      if (online) {
        console.log('Sync online, syncing all notes...')
        syncService.syncAllNotes(notes)
      }
    })

    return () => {
      syncService.dispose()
    }
  }, [])

  useEffect(() => {
    if (isOnline && notes.length > 0) {
      syncService.syncAllNotes(notes)
    }
  }, [isOnline, notes])

  const loadNotes = async () => {
    try {
      const notesData = await getNotes()
      setNotes(notesData)
      if (notesData.length > 0 && !selectedNote) {
        setSelectedNote(notesData[0])
      }
    } catch (error) {
      console.error('Failed to load notes:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateNote = async () => {
    try {
      const newNote = await createNote('新笔记', '')
      setNotes(prev => [newNote, ...prev])
      setSelectedNote(newNote)
      
      if (isOnline) {
        syncService.initializeNote(newNote)
      }
    } catch (error) {
      console.error('Failed to create note:', error)
    }
  }

  const handleSelectNote = useCallback((note: Note) => {
    setSelectedNote(note)
  }, [])

  const handleSaveNote = useCallback(async (title: string, content: string) => {
    if (!selectedNote) return
    try {
      await updateNote(selectedNote.id, title, content)
      await loadNotes()
    } catch (error) {
      console.error('Failed to update note:', error)
    }
  }, [selectedNote])

  const handleDeleteNote = async (id: number) => {
    if (!confirm('确定要删除这个笔记吗？')) return
    try {
      await deleteNote(id)
      setNotes(prev => prev.filter(n => n.id !== id))
      if (selectedNote?.id === id) {
        const remaining = notes.filter(n => n.id !== id)
        setSelectedNote(remaining.length > 0 ? remaining[0] : null)
      }
    } catch (error) {
      console.error('Failed to delete note:', error)
    }
  }

  const handleBackup = useCallback(async () => {
    if (selectedNote) {
      await backupNote(selectedNote)
      alert('笔记已备份到文档目录')
    }
  }, [selectedNote])

  if (loading) {
    return (
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <p>加载中...</p>
      </div>
    )
  }

  return (
    <div class="app-container">
      <NoteList
        notes={notes}
        selectedNoteId={selectedNote?.id || null}
        onSelectNote={handleSelectNote}
        onCreateNote={handleCreateNote}
        onDeleteNote={handleDeleteNote}
      />
      <MarkdownEditor
        note={selectedNote}
        onSave={handleSaveNote}
        onBackup={handleBackup}
        isOnline={isOnline}
      />
    </div>
  )
}
