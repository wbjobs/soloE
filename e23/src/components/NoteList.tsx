import { Note } from '../types'
import './NoteList.css'

interface NoteListProps {
  notes: Note[]
  selectedNoteId: number | null
  onSelectNote: (note: Note) => void
  onCreateNote: () => void
  onDeleteNote: (id: number) => void
}

export default function NoteList({ notes, selectedNoteId, onSelectNote, onCreateNote, onDeleteNote }: NoteListProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div class="note-list-container">
      <div class="note-list-header">
        <h2>笔记</h2>
        <button class="create-btn" onClick={onCreateNote}>+ 新建</button>
      </div>
      <div class="note-list">
        {notes.length === 0 ? (
          <div class="empty-state">
            <p>暂无笔记</p>
            <p>点击"新建"创建第一个笔记</p>
          </div>
        ) : (
          notes.map(note => (
            <div
              key={note.id}
              class={`note-item ${selectedNoteId === note.id ? 'selected' : ''}`}
              onClick={() => onSelectNote(note)}
            >
              <div class="note-item-content">
                <h3 class="note-title">{note.title || '无标题'}</h3>
                <p class="note-preview">{note.content.slice(0, 50) || '无内容...'}</p>
                <span class="note-date">{formatDate(note.last_modified)}</span>
              </div>
              <button
                class="delete-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteNote(note.id)
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
