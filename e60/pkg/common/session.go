package common

import (
	"bytes"
	"io"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/quic-go/quic-go"
)

type WebSocketSession struct {
	SessionID    string
	WSConn       *websocket.Conn
	QUICStream   quic.Stream
	ReadBuffer   *bytes.Buffer
	WriteBuffer  *bytes.Buffer
	CreatedAt    time.Time
	LastActive   time.Time
	IsMigrated   bool
	mu           sync.RWMutex
}

type SessionManager struct {
	sessions   map[string]*WebSocketSession
	mu         sync.RWMutex
	maxAge     time.Duration
}

func NewSessionManager(maxAge time.Duration) *SessionManager {
	sm := &SessionManager{
		sessions: make(map[string]*WebSocketSession),
		maxAge:   maxAge,
	}
	go sm.cleanupLoop()
	return sm
}

func (sm *SessionManager) CreateSession(sessionID string, wsConn *websocket.Conn, stream quic.Stream) *WebSocketSession {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	session := &WebSocketSession{
		SessionID:   sessionID,
		WSConn:      wsConn,
		QUICStream:  stream,
		ReadBuffer:  bytes.NewBuffer(nil),
		WriteBuffer: bytes.NewBuffer(nil),
		CreatedAt:   time.Now(),
		LastActive:  time.Now(),
	}
	sm.sessions[sessionID] = session

	log.Printf("Session %s created", sessionID)
	return session
}

func (sm *SessionManager) GetSession(sessionID string) (*WebSocketSession, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	session, exists := sm.sessions[sessionID]
	return session, exists
}

func (sm *SessionManager) RemoveSession(sessionID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	delete(sm.sessions, sessionID)
	log.Printf("Session %s removed", sessionID)
}

func (sm *SessionManager) SaveSessionState(sessionID string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	session, exists := sm.sessions[sessionID]
	if !exists {
		return &NoSessionError{}
	}

	session.mu.Lock()
	defer session.mu.Unlock()

	session.LastActive = time.Now()
	session.IsMigrated = true

	log.Printf("Session %s state saved for migration", sessionID)
	return nil
}

func (sm *SessionManager) RestoreSession(sessionID string, newStream quic.Stream) (*WebSocketSession, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	session, exists := sm.sessions[sessionID]
	if !exists {
		return nil, &NoSessionError{}
	}

	session.mu.Lock()
	defer session.mu.Unlock()

	if session.QUICStream != nil {
		session.QUICStream.Close()
	}

	session.QUICStream = newStream
	session.IsMigrated = false
	session.LastActive = time.Now()

	log.Printf("Session %s restored on new stream", sessionID)
	return session, nil
}

func (sm *SessionManager) cleanupLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		sm.cleanup()
	}
}

func (sm *SessionManager) cleanup() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	now := time.Now()
	for id, session := range sm.sessions {
		session.mu.RLock()
		expired := now.Sub(session.LastActive) > sm.maxAge
		session.mu.RUnlock()

		if expired {
			delete(sm.sessions, id)
			log.Printf("Session %s expired due to inactivity", id)
		}
	}
}

func (sm *SessionManager) GetSessionCount() int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return len(sm.sessions)
}

type SeamlessProxy struct {
	sessionManager *SessionManager
	msc            *MultiServerClient
	bufferSize    int
}

func NewSeamlessProxy(msc *MultiServerClient, sessionMaxAge time.Duration) *SeamlessProxy {
	return &SeamlessProxy{
		sessionManager: NewSessionManager(sessionMaxAge),
		msc:            msc,
		bufferSize:     64 * 1024,
	}
}

func (sp *SeamlessProxy) HandleWebSocket(wsConn *websocket.Conn, sessionID string, targetAddr string) error {
	stream, err := sp.msc.OpenStreamSync(nil)
	if err != nil {
		return err
	}

	session := sp.sessionManager.CreateSession(sessionID, wsConn, stream)

	var wg sync.WaitGroup
	wg.Add(2)

	errChan := make(chan error, 2)

	go func() {
		defer wg.Done()
		errChan <- sp.copyWebSocketToQUIC(session)
	}()

	go func() {
		defer wg.Done()
		errChan <- sp.copyQUICToWebSocket(session)
	}()

	sp.setupFailoverHandlers(session, targetAddr)

	wg.Wait()

	return nil
}

func (sp *SeamlessProxy) copyWebSocketToQUIC(session *WebSocketSession) error {
	buf := make([]byte, sp.bufferSize)

	for {
		_, reader, err := session.WSConn.NextReader()
		if err != nil {
			return err
		}

		for {
			n, err := reader.Read(buf)
			if n > 0 {
				session.mu.Lock()
				session.ReadBuffer.Write(buf[:n])
				session.LastActive = time.Now()
				session.mu.Unlock()

				_, writeErr := session.QUICStream.Write(buf[:n])
				if writeErr != nil {
					return writeErr
				}
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				return err
			}
		}
	}
}

func (sp *SeamlessProxy) copyQUICToWebSocket(session *WebSocketSession) error {
	buf := make([]byte, sp.bufferSize)

	for {
		n, err := session.QUICStream.Read(buf)
		if n > 0 {
			session.mu.Lock()
			session.WriteBuffer.Write(buf[:n])
			session.LastActive = time.Now()
			session.mu.Unlock()

			writer, err := session.WSConn.NextWriter(websocket.BinaryMessage)
			if err != nil {
				return err
			}

			_, err = writer.Write(buf[:n])
			if err != nil {
				return err
			}

			if err := writer.Close(); err != nil {
				return err
			}
		}
		if err != nil {
			return err
		}
	}
}

func (sp *SeamlessProxy) setupFailoverHandlers(session *WebSocketSession, targetAddr string) {
	sp.msc.SetConnectionLostHandler(func() {
		log.Printf("Connection lost, saving session %s state", session.SessionID)
		sp.sessionManager.SaveSessionState(session.SessionID)
	})

	sp.msc.SetConnectionRestoredHandler(func() {
		log.Printf("Connection restored, restoring session %s", session.SessionID)
		
		newStream, err := sp.msc.OpenStreamSync(nil)
		if err != nil {
			log.Printf("Failed to create new stream during restore: %v", err)
			return
		}

		_, err = sp.sessionManager.RestoreSession(session.SessionID, newStream)
		if err != nil {
			log.Printf("Failed to restore session: %v", err)
			return
		}

		log.Printf("Session %s successfully restored on new connection", session.SessionID)
	})
}

func (sp *SeamlessProxy) GetSessionManager() *SessionManager {
	return sp.sessionManager
}

func (sp *SeamlessProxy) GetMultiServerClient() *MultiServerClient {
	return sp.msc
}
