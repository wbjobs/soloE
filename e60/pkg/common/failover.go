package common

import (
	"context"
	"crypto/tls"
	"io"
	"log"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
)

type ServerConfig struct {
	Address  string
	Priority int
	TLSConfig *tls.Config
}

type ConnectionState string

const (
	StateConnected    ConnectionState = "connected"
	StateConnecting   ConnectionState = "connecting"
	StateDisconnected ConnectionState = "disconnected"
	StateReconnecting ConnectionState = "reconnecting"
)

type StreamMigration struct {
	StreamID   quic.StreamID
	DataBuffer []byte
	ReadPos    int
}

type SessionState struct {
	SessionID      string
	Streams        map[quic.StreamID]*StreamMigration
	CreatedAt      time.Time
	LastActive     time.Time
	mu             sync.RWMutex
}

func NewSessionState(sessionID string) *SessionState {
	return &SessionState{
		SessionID:  sessionID,
		Streams:    make(map[quic.StreamID]*StreamMigration),
		CreatedAt:  time.Now(),
		LastActive: time.Now(),
	}
}

func (s *SessionState) SaveStream(stream quic.Stream, data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.Streams[stream.StreamID()] = &StreamMigration{
		StreamID:   stream.StreamID(),
		DataBuffer: data,
		ReadPos:    0,
	}
	s.LastActive = time.Now()
}

func (s *SessionState) GetStream(streamID quic.StreamID) (*StreamMigration, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sm, ok := s.Streams[streamID]
	return sm, ok
}

func (s *SessionState) RemoveStream(streamID quic.StreamID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.Streams, streamID)
}

type MultiServerClient struct {
	servers         []*ServerConfig
	currentServer   int
	conn            *QuicConnectionWrapper
	rawConn         quic.Connection
	session         *SessionState
	state           ConnectionState
	mu              sync.RWMutex
	
	reconnectAttempts int
	maxReconnectAttempts int
	reconnectDelay    time.Duration
	
	connLostHandler  func()
	connRestoredHandler func()
	
	stopChan        chan struct{}
}

func NewMultiServerClient(servers []*ServerConfig) *MultiServerClient {
	return &MultiServerClient{
		servers:             servers,
		currentServer:       0,
		state:               StateDisconnected,
		maxReconnectAttempts: 5,
		reconnectDelay:      500 * time.Millisecond,
		stopChan:            make(chan struct{}),
	}
}

func (msc *MultiServerClient) SetConnectionLostHandler(handler func()) {
	msc.connLostHandler = handler
}

func (msc *MultiServerClient) SetConnectionRestoredHandler(handler func()) {
	msc.connRestoredHandler = handler
}

func (msc *MultiServerClient) Connect() error {
	msc.mu.Lock()
	defer msc.mu.Unlock()

	return msc.connectToServer(msc.currentServer)
}

func (msc *MultiServerClient) connectToServer(serverIdx int) error {
	if serverIdx < 0 || serverIdx >= len(msc.servers) {
		return &NoServerError{}
	}

	server := msc.servers[serverIdx]
	msc.state = StateConnecting

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := quic.DialAddrEarly(ctx, server.Address, server.TLSConfig, &quic.Config{
		Enable0RTT:         true,
		MaxIncomingStreams: 100,
		MaxIdleTimeout:     30 * time.Second,
	})
	if err != nil {
		msc.state = StateDisconnected
		return err
	}

	msc.rawConn = conn
	msc.conn = NewQuicConnectionWrapper(conn)
	msc.currentServer = serverIdx
	msc.state = StateConnected
	msc.reconnectAttempts = 0

	log.Printf("Connected to server %s (priority %d)", server.Address, server.Priority)

	go msc.monitorConnection()

	return nil
}

func (msc *MultiServerClient) monitorConnection() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			msc.checkConnection()
		case <-msc.stopChan:
			return
		}
	}
}

func (msc *MultiServerClient) checkConnection() {
	msc.mu.RLock()
	state := msc.state
	msc.mu.RUnlock()

	if state != StateConnected {
		return
	}

	_, err := msc.conn.conn.GetConnectionState()
	if err != nil {
		log.Printf("Connection check failed: %v", err)
		go msc.failover()
	}
}

func (msc *MultiServerClient) failover() {
	msc.mu.Lock()
	if msc.state == StateReconnecting {
		msc.mu.Unlock()
		return
	}
	msc.state = StateReconnecting
	msc.mu.Unlock()

	if msc.connLostHandler != nil {
		go msc.connLostHandler()
	}

	log.Printf("Starting failover process...")

	for attempt := 0; attempt < msc.maxReconnectAttempts; attempt++ {
		nextServer := (msc.currentServer + 1) % len(msc.servers)
		log.Printf("Failover attempt %d: trying server %d", attempt+1, nextServer)

		msc.mu.Lock()
		err := msc.connectToServer(nextServer)
		msc.mu.Unlock()

		if err == nil {
			log.Printf("Failover successful! Switched to server %s", 
				msc.servers[nextServer].Address)
			
			if msc.connRestoredHandler != nil {
				go msc.connRestoredHandler()
			}
			return
		}

		log.Printf("Failover attempt %d failed: %v", attempt+1, err)
		time.Sleep(msc.reconnectDelay * time.Duration(attempt+1))
	}

	msc.mu.Lock()
	msc.state = StateDisconnected
	msc.mu.Unlock()
	log.Printf("All failover attempts failed")
}

func (msc *MultiServerClient) OpenStreamSync(ctx context.Context) (quic.Stream, error) {
	msc.mu.RLock()
	if msc.state != StateConnected || msc.conn == nil {
		msc.mu.RUnlock()
		return nil, &NotConnectedError{}
	}
	conn := msc.conn
	msc.mu.RUnlock()

	return conn.OpenStreamSync(ctx)
}

func (msc *MultiServerClient) GetConnection() *QuicConnectionWrapper {
	msc.mu.RLock()
	defer msc.mu.RUnlock()
	return msc.conn
}

func (msc *MultiServerClient) GetState() ConnectionState {
	msc.mu.RLock()
	defer msc.mu.RUnlock()
	return msc.state
}

func (msc *MultiServerClient) GetCurrentServer() *ServerConfig {
	msc.mu.RLock()
	defer msc.mu.RUnlock()
	if msc.currentServer >= 0 && msc.currentServer < len(msc.servers) {
		return msc.servers[msc.currentServer]
	}
	return nil
}

func (msc *MultiServerClient) SaveSession(sessionID string) {
	msc.mu.Lock()
	defer msc.mu.Unlock()

	msc.session = NewSessionState(sessionID)
	log.Printf("Session %s saved for migration", sessionID)
}

func (msc *MultiServerClient) MigrateSession(newConn *QuicConnectionWrapper) error {
	msc.mu.Lock()
	defer msc.mu.Unlock()

	if msc.session == nil {
		return &NoSessionError{}
	}

	log.Printf("Starting session migration: %s, %d streams to migrate", 
		msc.session.SessionID, len(msc.session.Streams))

	msc.conn = newConn
	return nil
}

func (msc *MultiServerClient) Close() error {
	close(msc.stopChan)
	msc.mu.Lock()
	defer msc.mu.Unlock()

	if msc.rawConn != nil {
		return msc.rawConn.CloseWithError(0, "")
	}
	return nil
}

type NoServerError struct{}

func (e *NoServerError) Error() string {
	return "no available server"
}

type NotConnectedError struct{}

func (e *NotConnectedError) Error() string {
	return "not connected"
}

type NoSessionError struct{}

func (e *NoSessionError) Error() string {
	return "no session to migrate"
}

type MigratedStream struct {
	stream    quic.Stream
	migration *StreamMigration
	readPos   int
}

func NewMigratedStream(stream quic.Stream, migration *StreamMigration) *MigratedStream {
	return &MigratedStream{
		stream:    stream,
		migration: migration,
		readPos:   0,
	}
}

func (ms *MigratedStream) Read(p []byte) (n int, err error) {
	if ms.readPos < len(ms.migration.DataBuffer) {
		n = copy(p, ms.migration.DataBuffer[ms.readPos:])
		ms.readPos += n
		return n, nil
	}
	return ms.stream.Read(p)
}

func (ms *MigratedStream) Write(p []byte) (n int, err error) {
	return ms.stream.Write(p)
}

func (ms *MigratedStream) Close() error {
	return ms.stream.Close()
}

func (ms *MigratedStream) StreamID() quic.StreamID {
	return ms.stream.StreamID()
}

func (ms *MigratedStream) SetDeadline(t time.Time) error {
	return ms.stream.SetDeadline(t)
}

func (ms *MigratedStream) SetReadDeadline(t time.Time) error {
	return ms.stream.SetReadDeadline(t)
}

func (ms *MigratedStream) SetWriteDeadline(t time.Time) error {
	return ms.stream.SetWriteDeadline(t)
}

func (ms *MigratedStream) CancelRead(errorCode quic.StreamErrorCode) {
	ms.stream.CancelRead(errorCode)
}

func (ms *MigratedStream) CancelWrite(errorCode quic.StreamErrorCode) {
	ms.stream.CancelWrite(errorCode)
}

func (ms *MigratedStream) Context() context.Context {
	return ms.stream.Context()
}
