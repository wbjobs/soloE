import { useState, useEffect, useRef } from 'react'
import './App.css'

function computeOperations(oldText, newText, cursorPosition) {
  const operations = []
  let i = 0
  let j = 0
  
  while (i < oldText.length && j < newText.length && oldText[i] === newText[j]) {
    i++
    j++
  }
  
  const commonPrefix = i
  
  i = oldText.length - 1
  j = newText.length - 1
  
  while (i >= commonPrefix && j >= commonPrefix && oldText[i] === newText[j]) {
    i--
    j--
  }
  
  const deleteLength = oldText.length - commonPrefix - (oldText.length - 1 - i)
  
  if (deleteLength > 0) {
    operations.push({
      type: 'delete',
      position: commonPrefix,
      length: deleteLength
    })
  }
  
  const insertContent = newText.slice(commonPrefix, j + 1)
  
  if (insertContent.length > 0) {
    operations.push({
      type: 'insert',
      position: commonPrefix,
      content: insertContent
    })
  }
  
  return operations
}

function applyOperation(text, op) {
  if (op.type === 'insert') {
    return text.slice(0, op.position) + op.content + text.slice(op.position)
  } else if (op.type === 'delete') {
    return text.slice(0, op.position) + text.slice(op.position + op.length)
  }
  return text
}

function transform(op1, op2) {
  if (op1.type === 'insert' && op2.type === 'insert') {
    if (op1.position <= op2.position) {
      return op1
    }
    return { ...op1, position: op1.position + op2.content.length }
  }
  
  if (op1.type === 'delete' && op2.type === 'insert') {
    if (op1.position < op2.position) {
      return op1
    }
    return { ...op1, position: op1.position + op2.content.length }
  }
  
  if (op1.type === 'insert' && op2.type === 'delete') {
    if (op1.position <= op2.position) {
      return op1
    }
    if (op1.position >= op2.position + op2.length) {
      return { ...op1, position: op1.position - op2.length }
    }
    return null
  }
  
  if (op1.type === 'delete' && op2.type === 'delete') {
    if (op1.position <= op2.position) {
      if (op1.position + op1.length <= op2.position) {
        return op1
      }
      return { ...op1, length: Math.min(op1.length, op2.position - op1.position) }
    }
    if (op2.position + op2.length <= op1.position) {
      return { ...op1, position: op1.position - op2.length }
    }
    if (op2.position + op2.length >= op1.position + op1.length) {
      return null
    }
    return {
      ...op1,
      position: op2.position,
      length: op1.position + op1.length - (op2.position + op2.length)
    }
  }
  
  return op1
}

function App() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState('连接中...')
  const [version, setVersion] = useState(0)
  const [username, setUsername] = useState('')
  const [currentUser, setCurrentUser] = useState(null)
  const [onlineUsers, setOnlineUsers] = useState([])
  const [lastEditor, setLastEditor] = useState(null)
  const wsRef = useRef(null)
  const lastTextRef = useRef('')
  const pendingOps = useRef([])

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080')
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('已连接 - 请输入用户名')
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      
      if (data.type === 'init') {
        setText(data.content)
        lastTextRef.current = data.content
        setVersion(data.version)
        setCurrentUser(data.username)
        setStatus('已连接 - ' + data.username)
      } else if (data.type === 'operation') {
        let op = data.operation
        
        for (let i = 0; i < pendingOps.current.length; i++) {
          op = transform(op, pendingOps.current[i])
          if (!op) break
        }
        
        if (op) {
          setText(prev => {
            const newText = applyOperation(prev, op)
            lastTextRef.current = newText
            return newText
          })
        }
        
        setVersion(data.version)
        if (data.username) {
          setLastEditor(data.username)
        }
        
        if (pendingOps.current.length > 0) {
          pendingOps.current = pendingOps.current.map(pendingOp => {
            const transformed = transform(pendingOp, data.operation)
            return transformed
          }).filter(Boolean)
        }
      } else if (data.type === 'userList') {
        setOnlineUsers(data.users)
      } else if (data.type === 'error') {
        console.error('Server error:', data.message)
      }
    }

    ws.onclose = () => {
      setStatus('已断开')
    }

    ws.onerror = () => {
      setStatus('连接错误')
    }

    return () => {
      ws.close()
    }
  }, [])

  const handleAuth = (e) => {
    e.preventDefault()
    if (username.trim() && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'auth',
        username: username.trim()
      }))
    }
  }

  const handleTextChange = (e) => {
    if (!currentUser) return
    
    const newText = e.target.value
    const oldText = lastTextRef.current
    
    const operations = computeOperations(oldText, newText, e.target.selectionStart)
    
    operations.forEach(op => {
      pendingOps.current.push(op)
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'operation',
          operation: op,
          baseVersion: version
        }))
      }
    })
    
    setText(newText)
    lastTextRef.current = newText
  }

  return (
    <div className="app">
      <div className="header">
        <h1>在线协作文本编辑器</h1>
        <div className={`status ${status.includes('已连接') && currentUser ? 'connected' : ''}`}>
          <span className="status-dot"></span>
          {status}
        </div>
      </div>
      
      {!currentUser ? (
        <div className="auth-container">
          <div className="auth-box">
            <h2>输入您的用户名</h2>
            <form onSubmit={handleAuth}>
              <input
                type="text"
                className="username-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名..."
                autoFocus
              />
              <button type="submit" className="auth-button" disabled={!username.trim()}>
                进入编辑器
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="main-content">
          <div className="user-sidebar">
            <h3>在线用户 ({onlineUsers.length})</h3>
            <ul className="user-list">
              {onlineUsers.map((user, index) => (
                <li key={index} className={`user-item ${user === currentUser ? 'current-user' : ''}`}>
                  <span className="user-avatar">
                    {user.charAt(0).toUpperCase()}
                  </span>
                  <span className="user-name">{user}</span>
                  {user === currentUser && <span className="user-badge">我</span>}
                </li>
              ))}
            </ul>
            {lastEditor && (
              <div className="last-editor">
                <small>最后编辑: {lastEditor}</small>
              </div>
            )}
          </div>
          
          <div className="editor-wrapper">
            <div className="editor-container">
              <textarea
                className="editor"
                value={text}
                onChange={handleTextChange}
                placeholder="开始输入内容，所有连接的客户端将实时看到变更..."
                spellCheck="false"
              />
            </div>
            
            <div className="footer">
              <p>提示：在多个浏览器窗口中打开此页面，测试实时协作功能</p>
              <p className="version">文档版本: {version}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
