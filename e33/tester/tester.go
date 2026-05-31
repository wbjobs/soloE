package tester

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"quic-load-tester/config"
	"quic-load-tester/stats"
)

type LoadTester struct {
	config         *config.Config
	metrics        *stats.Metrics
	connPool       *ConnectionPool
	logBuffer      *RingBuffer
	bufferPool     *BufferPool
	requestBody    []byte
	sessionTracker *SessionTracker
	logWorkerWg    sync.WaitGroup
}

type PooledConnection struct {
	rt        *http3.RoundTripper
	createdAt time.Time
	lastUsed  time.Time
	useCount  int
}

type ConnectionPool struct {
	pool        chan *PooledConnection
	capacity    int
	maxLifetime time.Duration
	maxUses     int
	tlsConf     *tls.Config
	quicConf    *quic.Config
	mu          sync.Mutex
	active      int
	closed      bool
}

type RingBuffer struct {
	buffer   chan string
	capacity int
	wg       sync.WaitGroup
	ctx      context.Context
	cancel   context.CancelFunc
}

func NewRingBuffer(capacity int) *RingBuffer {
	ctx, cancel := context.WithCancel(context.Background())
	rb := &RingBuffer{
		buffer:   make(chan string, capacity),
		capacity: capacity,
		ctx:      ctx,
		cancel:   cancel,
	}
	return rb
}

func (rb *RingBuffer) Start() {
	rb.wg.Add(1)
	go func() {
		defer rb.wg.Done()
		for {
			select {
			case msg := <-rb.buffer:
				fmt.Println(msg)
			case <-rb.ctx.Done():
				for len(rb.buffer) > 0 {
					fmt.Println(<-rb.buffer)
				}
				return
			}
		}
	}()
}

func (rb *RingBuffer) Write(msg string) {
	select {
	case rb.buffer <- msg:
	default:
	}
}

func (rb *RingBuffer) Stop() {
	rb.cancel()
	rb.wg.Wait()
}

func NewConnectionPool(capacity int, tlsConf *tls.Config, quicConf *quic.Config) *ConnectionPool {
	return &ConnectionPool{
		pool:        make(chan *PooledConnection, capacity),
		capacity:    capacity,
		maxLifetime: 10 * time.Minute,
		maxUses:     10000,
		tlsConf:     tlsConf,
		quicConf:    quicConf,
	}
}

func (p *ConnectionPool) Get() (*PooledConnection, error) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, fmt.Errorf("pool closed")
	}
	p.mu.Unlock()

	select {
	case conn := <-p.pool:
		if p.isExpired(conn) {
			conn.rt.Close()
			return p.createNew(), nil
		}
		p.mu.Lock()
		p.active++
		p.mu.Unlock()
		return conn, nil
	default:
		p.mu.Lock()
		if p.active < p.capacity {
			conn := p.createNew()
			p.active++
			p.mu.Unlock()
			return conn, nil
		}
		p.mu.Unlock()
		conn := <-p.pool
		if p.isExpired(conn) {
			conn.rt.Close()
			p.mu.Lock()
			newConn := p.createNew()
			p.mu.Unlock()
			return newConn, nil
		}
		p.mu.Lock()
		p.active++
		p.mu.Unlock()
		return conn, nil
	}
}

func (p *ConnectionPool) createNew() *PooledConnection {
	rt := &http3.RoundTripper{
		TLSClientConfig: p.tlsConf,
		QuicConfig:      p.quicConf,
	}
	return &PooledConnection{
		rt:        rt,
		createdAt: time.Now(),
		lastUsed:  time.Now(),
		useCount:  0,
	}
}

func (p *ConnectionPool) isExpired(conn *PooledConnection) bool {
	if conn.useCount >= p.maxUses {
		return true
	}
	if time.Since(conn.createdAt) > p.maxLifetime {
		return true
	}
	return false
}

func (p *ConnectionPool) Put(conn *PooledConnection) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed {
		conn.rt.Close()
		return
	}

	p.active--
	conn.lastUsed = time.Now()
	conn.useCount++

	if p.isExpired(conn) {
		conn.rt.Close()
		return
	}

	select {
	case p.pool <- conn:
	default:
		conn.rt.Close()
	}
}

func (p *ConnectionPool) CloseAll() {
	p.mu.Lock()
	p.closed = true
	p.mu.Unlock()

	close(p.pool)
	for conn := range p.pool {
		conn.rt.Close()
	}
}

func NewLoadTester(cfg *config.Config) *LoadTester {
	lt := &LoadTester{
		config:         cfg,
		metrics:        stats.NewMetrics(),
		logBuffer:      NewRingBuffer(1000),
		bufferPool:     NewBufferPool(),
		sessionTracker: NewSessionTracker(),
	}
	if cfg.RequestBody > 0 {
		lt.requestBody = lt.generateRequestBody(cfg.RequestBody)
	}
	return lt
}

func (lt *LoadTester) createTLSConfig() *tls.Config {
	return &tls.Config{
		InsecureSkipVerify: lt.config.Server.Insecure,
		NextProtos:         []string{"h3"},
		ClientSessionCache: lt.sessionTracker.GetSessionCache(),
		SessionTicketsDisabled: false,
	}
}

func (lt *LoadTester) createQUICConfig() *quic.Config {
	return &quic.Config{
		MaxIdleTimeout:  30 * time.Second,
		KeepAlivePeriod: 10 * time.Second,
	}
}

func (lt *LoadTester) Run() error {
	fmt.Printf("Starting QUIC load test with %d concurrent connections...\n", lt.config.Concurrency)

	lt.logBuffer.Start()

	poolSize := lt.config.Concurrency
	lt.connPool = NewConnectionPool(
		poolSize,
		lt.createTLSConfig(),
		lt.createQUICConfig(),
	)

	var wg sync.WaitGroup
	semaphore := make(chan struct{}, lt.config.Concurrency)

	var requestInterval time.Duration
	if lt.config.RequestsPerSec > 0 {
		requestInterval = time.Second / time.Duration(lt.config.RequestsPerSec)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if lt.config.Duration > 0 {
		go func() {
			time.Sleep(time.Duration(lt.config.Duration) * time.Second)
			cancel()
		}()
	}

	requestCount := 0
	ticker := time.NewTicker(requestInterval)
	defer ticker.Stop()

	if requestInterval == 0 {
		ticker.Stop()
	}

	for {
		select {
		case <-ctx.Done():
			wg.Wait()
			lt.logBuffer.Write("\nTest completed!")
			lt.logBuffer.Stop()
			lt.connPool.CloseAll()
			return nil
		default:
			if requestInterval == 0 {
				if lt.config.RequestCount > 0 && requestCount >= lt.config.RequestCount {
					wg.Wait()
					lt.logBuffer.Write("\nRequest count reached!")
					lt.logBuffer.Stop()
					lt.connPool.CloseAll()
					return nil
				}

				semaphore <- struct{}{}
				wg.Add(1)
				requestCount++

				go func(reqNum int) {
					defer wg.Done()
					defer func() { <-semaphore }()
					lt.runWorker(ctx, reqNum)
				}(requestCount)
			} else {
				<-ticker.C
				if lt.config.RequestCount > 0 && requestCount >= lt.config.RequestCount {
					wg.Wait()
					lt.logBuffer.Write("\nRequest count reached!")
					lt.logBuffer.Stop()
					lt.connPool.CloseAll()
					return nil
				}

				semaphore <- struct{}{}
				wg.Add(1)
				requestCount++

				go func(reqNum int) {
					defer wg.Done()
					defer func() { <-semaphore }()
					lt.runWorker(ctx, reqNum)
				}(requestCount)
			}
		}
	}
}

func (lt *LoadTester) runWorker(ctx context.Context, reqNum int) {
	conn, err := lt.connPool.Get()
	if err != nil {
		lt.metrics.IncrementFailedRequests()
		lt.logBuffer.Write(fmt.Sprintf("Request %d: failed to get connection: %v", reqNum, err))
		return
	}
	defer lt.connPool.Put(conn)

	start := time.Now()
	lt.makeRequest(ctx, conn.rt, reqNum)
	connTime := time.Since(start)

	if conn.useCount == 0 {
		lt.metrics.RecordConnectionTime(connTime)
	}
}

func (lt *LoadTester) makeRequest(ctx context.Context, rt *http3.RoundTripper, reqNum int) {
	url := fmt.Sprintf("https://%s:%d%s", lt.config.Server.Host, lt.config.Server.Port, lt.config.Server.Path)

	var body io.Reader
	if lt.config.RequestBody > 0 {
		body = bytes.NewReader(lt.requestBody)
	}

	req, err := http.NewRequestWithContext(ctx, lt.config.Server.Method, url, body)
	if err != nil {
		lt.metrics.IncrementFailedRequests()
		lt.logBuffer.Write(fmt.Sprintf("Request %d: create request failed: %v", reqNum, err))
		return
	}

	if lt.config.RequestBody > 0 {
		req.Header.Set("Content-Type", "application/octet-stream")
	}

	start := time.Now()
	resp, err := rt.RoundTrip(req)
	rtt := time.Since(start)

	lt.metrics.IncrementTotalRequests()
	lt.metrics.RecordRequestRTT(rtt)

	if err != nil {
		lt.metrics.IncrementFailedRequests()
		return
	}

	io.Copy(GetDiscard(), resp.Body)
	resp.Body.Close()

	if reqNum%1000 == 0 {
		lt.logBuffer.Write(fmt.Sprintf("Completed %d requests...", reqNum))
	}
}

func (lt *LoadTester) generateRequestBody(size int) []byte {
	data := make([]byte, size)
	rand.Read(data)
	return data
}

func (lt *LoadTester) GetMetrics() *stats.Metrics {
	return lt.metrics
}

func (lt *LoadTester) SyncSessionStats() {
	sessionStats := lt.sessionTracker.GetStats()
	lt.metrics.SetSessionStats(sessionStats.ReusedSessions, sessionStats.NewSessions, sessionStats.TotalConnections)
}

func (lt *LoadTester) GetSessionReuseRate() float64 {
	return lt.sessionTracker.GetReuseRate()
}
