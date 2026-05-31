import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { marked } from 'marked'
import * as Y from 'yjs'
import { Note } from '../types'
import { syncService } from '../sync'
import './MarkdownEditor.css'

interface MarkdownEditorProps {
  note: Note | null
  onSave: (title: string, content: string) => void
  onBackup: () => void
  isOnline: boolean
}

export default function MarkdownEditor({ note, onSave, onBackup, isOnline }: MarkdownEditorProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | null>(null)
  const ydocRef = useRef<Y.Doc | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!note) {
      ydocRef.current = null
      setTitle('')
      setContent('')
      return
    }

    const ydoc = syncService.initializeNote(note)
    ydocRef.current = ydoc

    const ytitle = ydoc.getText('title')
    const ycontent = ydoc.getText('content')

    const syncFromYjs = () => {
      setTitle(ytitle.toString())
      setContent(ycontent.toString())
    }

    syncFromYjs()

    ytitle.observe(syncFromYjs)
    ycontent.observe(syncFromYjs)

    return () => {
      ytitle.unobserve(syncFromYjs)
      ycontent.unobserve(syncFromYjs)
    }
  }, [note])

  const handleTitleChange = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement
    const newValue = target.value
    
    if (ydocRef.current) {
      const ytitle = ydocRef.current.getText('title')
      const currentValue = ytitle.toString()
      
      let start = 0
      while (start < currentValue.length && start < newValue.length && 
             currentValue[start] === newValue[start]) {
        start++
      }
      
      const endCurrent = currentValue.length - 1
      const endNew = newValue.length - 1
      let end = 0
      while (endCurrent - end >= start && endNew - end >= start && 
             currentValue[endCurrent - end] === newValue[endNew - end]) {
        end++
      }
      
      const deleteCount = currentValue.length - start - end
      const insertText = newValue.slice(start, newValue.length - end)
      
      ydocRef.current.transact(() => {
        if (deleteCount > 0) {
          ytitle.delete(start, deleteCount)
        }
        if (insertText.length > 0) {
          ytitle.insert(start, insertText)
        }
      })
    }
    
    setTitle(newValue)
  }, [])

  const handleContentChange = useCallback((e: Event) => {
    const target = e.target as HTMLTextAreaElement
    const newValue = target.value
    
    if (ydocRef.current) {
      const ycontent = ydocRef.current.getText('content')
      const currentValue = ycontent.toString()
      
      let start = 0
      while (start < currentValue.length && start < newValue.length && 
             currentValue[start] === newValue[start]) {
        start++
      }
      
      const endCurrent = currentValue.length - 1
      const endNew = newValue.length - 1
      let end = 0
      while (endCurrent - end >= start && endNew - end >= start && 
             currentValue[endCurrent - end] === newValue[endNew - end]) {
        end++
      }
      
      const deleteCount = currentValue.length - start - end
      const insertText = newValue.slice(start, newValue.length - end)
      
      ydocRef.current.transact(() => {
        if (deleteCount > 0) {
          ycontent.delete(start, deleteCount)
        }
        if (insertText.length > 0) {
          ycontent.insert(start, insertText)
        }
      })
    }
    
    setContent(newValue)
  }, [])

  const handleSave = useCallback(async () => {
    if (!note) return
    setSaveStatus('saving')
    onSave(title, content)
    setTimeout(() => setSaveStatus('saved'), 300)
    setTimeout(() => setSaveStatus(null), 2000)
  }, [note, title, content, onSave])

  useEffect(() => {
    if (!note) return
    
    const timer = setTimeout(() => {
      handleSave()
    }, 1000)

    return () => clearTimeout(timer)
  }, [title, content, note, handleSave])

  const htmlContent = marked(content)

  if (!note) {
    return (
      <div class="editor-empty">
        <div class="empty-content">
          <h2>选择或创建一个笔记</h2>
          <p>在左侧列表中选择笔记，或点击"新建"按钮创建新笔记</p>
        </div>
      </div>
    )
  }

  return (
    <div class="editor-container">
      <div class="editor-header">
        <input
          ref={titleRef}
          type="text"
          class="title-input"
          placeholder="输入笔记标题..."
          value={title}
          onInput={handleTitleChange}
        />
        <div class="editor-actions">
          <span class={`status-badge ${isOnline ? 'online' : 'offline'}`}>
            {isOnline ? '● 已连接' : '○ 离线'}
          </span>
          {saveStatus === 'saving' && <span class="status-text">保存中...</span>}
          {saveStatus === 'saved' && <span class="status-text saved">已保存 ✓</span>}
          <button
            class={`action-btn ${showPreview ? 'active' : ''}`}
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? '编辑' : '预览'}
          </button>
          <button class="action-btn backup-btn" onClick={onBackup}>
            备份
          </button>
        </div>
      </div>
      
      <div class="editor-body">
        {!showPreview ? (
          <textarea
            ref={contentRef}
            class="editor-textarea"
            placeholder="在这里输入 Markdown 内容...

支持的格式：
# 一级标题
## 二级标题
**粗体**
*斜体*
- 列表
1. 有序列表
[链接](url)"
            value={content}
            onInput={handleContentChange}
          />
        ) : (
          <div class="preview-container">
            <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: htmlContent }} />
          </div>
        )}
      </div>
    </div>
  )
}
