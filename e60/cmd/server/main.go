package main

import (
	"context"
	"crypto/tls"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/quic-go/quic-go"

	"quic-proxy/pkg/common"
)

type ProxyServer struct {
	addr          string
	tlsConfig     *tls.Config
	quicConfig    *quic.Config
	listener      quic.Listener
	stats         *common.ConnectionStats
	connections   map[string]*common.QuicConnectionWrapper
	connMutex     sync.RWMutex
	loadBalancer  *common.LoadBalancer
	healthChecker *common.HealthChecker
	httpServer    *http.Server
}

func NewProxyServer(addr string) (*ProxyServer, error) {
	tlsConfig, err := common.GenerateTLSConfig()
	if err != nil {
		return nil, err
	}

	server := &ProxyServer{
		addr:      addr,
		tlsConfig: tlsConfig,
		quicConfig: &quic.Config{
			Enable0RTT:         true,
			MaxIncomingStreams: 100,
			MaxIdleTimeout:     30 * time.Second,
		},
		stats:        common.NewConnectionStats(),
		connections:  make(map[string]*common.QuicConnectionWrapper),
		loadBalancer: common.NewLoadBalancer(),
	}

	server.healthChecker = common.NewHealthChecker(
		common.HealthCheckTCP,
		5*time.Second,
		2*time.Second,
	)

	return server, nil
}

func (s *ProxyServer) AddBackend(routeID, address string, weight int) error {
	backend := &common.Backend{
		Address: address,
		Weight:  weight,
		Healthy: true,
	}

	s.healthChecker.AddBackend(backend)

	route := &common.RouteRule{
		ID:         routeID,
		Strategy:   common.StrategyLeastConnections,
		Backends:   []*common.Backend{backend},
	}

	return s.loadBalancer.AddRoute(route)
}

func (s *ProxyServer) AddRoute(rule *common.RouteRule) error {
	for _, backend := range rule.Backends {
		s.healthChecker.AddBackend(backend)
	}
	return s.loadBalancer.AddRoute(rule)
}

func (s *ProxyServer) StartHealthCheck() {
	s.healthChecker.Start()
}

func (s *ProxyServer) Start() error {
	listener, err := quic.ListenAddr(s.addr, s.tlsConfig, s.quicConfig)
	if err != nil {
		return err
	}
	s.listener = listener
	log.Printf("QUIC Proxy Server listening on", s.addr)

	for {
		conn, err := listener.Accept(context.Background())
		if err != nil {
			log.Printf("Failed to accept connection: %v", err)
			continue
		}
		log.Printf("New connection from %s", conn.RemoteAddr())
		go s.handleConnection(conn)
	}
}

func (s *ProxyServer) handleConnection(conn quic.Connection) {
	remoteAddr := conn.RemoteAddr().String()
	log.Printf("New connection from %s, enabling BBR congestion control", remoteAddr)

	wrapper := common.NewQuicConnectionWrapper(conn)
	s.connMutex.Lock()
	s.connections[remoteAddr] = wrapper
	s.connMutex.Unlock()

	defer func() {
		conn.CloseWithError(0, "")
		s.connMutex.Lock()
		delete(s.connections, remoteAddr)
		s.connMutex.Unlock()
	}()

	go s.monitorCongestion(wrapper)

	for {
		stream, err := wrapper.AcceptStream(context.Background())
		if err != nil {
			log.Printf("Failed to accept stream: %v", err)
			return
		}
		go s.handleStream(stream)
	}
}

func (s *ProxyServer) monitorCongestion(wrapper *common.QuicConnectionWrapper) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		bw, rtt, cwnd, lost := wrapper.GetBBR().GetStats()
		queueSize := wrapper.GetScheduler().GetQueueSize()
		log.Printf("BBR Stats - BW: %.2f Mbps, RTT: %v, CWND: %d, Lost: %d, Queue: %d",
			bw/1e6, rtt, cwnd, lost, queueSize)
	}
}

func (s *ProxyServer) handleStream(stream quic.Stream) {
	streamID := uint64(stream.StreamID())
	stats := s.stats.AddStream(streamID)
	log.Printf("New stream opened: %d", streamID)

	wrapper, ok := stream.(*common.QuicStreamWrapper)
	if ok {
		wrapper.SetPriority(common.PriorityNormal)
	}

	defer func() {
		stream.Close()
		sent, recv, duration := stats.GetStats()
		log.Printf("Stream %d closed: sent=%d, recv=%d, duration=%v", streamID, sent, recv, duration)
		s.stats.RemoveStream(streamID)
	}()

	headerLenBuf := make([]byte, 4)
	_, err := io.ReadFull(stream, headerLenBuf)
	if err != nil {
		log.Printf("Failed to read header length: %v", err)
		return
	}
	headerLen := uint32(headerLenBuf[0])<<24 | uint32(headerLenBuf[1])<<16 | uint32(headerLenBuf[2])<<8 | uint32(headerLenBuf[3])
	stats.AddRecv(4)

	compressedHeader := make([]byte, headerLen)
	_, err = io.ReadFull(stream, compressedHeader)
	if err != nil {
		log.Printf("Failed to read compressed header: %v", err)
		return
	}
	stats.AddRecv(int(headerLen))

	headerBytes, err := common.DecompressBrotli(compressedHeader)
	if err != nil {
		log.Printf("Failed to decompress header: %v", err)
		return
	}

	path := string(headerBytes)
	log.Printf("Stream %d: Request path: %s", streamID, path)

	route := s.loadBalancer.MatchRoute(path, nil)
	if route == nil {
		log.Printf("Stream %d: No matching route found", streamID)
		return
	}

	backend := s.loadBalancer.SelectBackend(route, "")
	if backend == nil {
		log.Printf("Stream %d: No healthy backend available", streamID)
		return
	}

	backend.IncrementLoad()
	defer backend.DecrementLoad()

	log.Printf("Stream %d: Routed to backend %s", streamID, backend.Address)

	targetConn, err := net.DialTimeout("tcp", backend.Address, 10*time.Second)
	if err != nil {
		log.Printf("Stream %d: Failed to connect to backend %s: %v", streamID, backend.Address, err)
		backend.MarkUnhealthy()
		return
	}
	defer targetConn.Close()

	backend.MarkHealthy()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		buf := make([]byte, 64*1024)
		for {
			n, err := stream.Read(buf)
			if n > 0 {
				stats.AddRecv(n)
				_, writeErr := targetConn.Write(buf[:n])
				if writeErr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	go func() {
		defer wg.Done()
		buf := make([]byte, 64*1024)
		for {
			n, err := targetConn.Read(buf)
			if n > 0 {
				_, writeErr := stream.Write(buf[:n])
				if writeErr != nil {
					return
				}
				stats.AddSent(n)
			}
			if err != nil {
				return
			}
		}
	}()

	wg.Wait()
}

func (s *ProxyServer) setupAdminAPI() {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	mux.HandleFunc("/stats/backends", func(w http.ResponseWriter, r *http.Request) {
		stats := s.healthChecker.GetBackendStats()
		w.Header().Set("Content-Type", "application/json")
		for addr, stat := range stats {
			healthy := stat["healthy"].(bool)
			load := stat["load"].(int64)
			w.Write([]byte(addr + ": healthy=" + string(rune(load)) + "\n"))
		}
	})

	mux.HandleFunc("/stats/connections", func(w http.ResponseWriter, r *http.Request) {
		s.connMutex.RLock()
		count := len(s.connections)
		s.connMutex.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"active_connections": ` + string(rune(count)) + `}`))
	})

	s.httpServer = &http.Server{
		Addr:    ":8080",
		Handler: mux,
	}

	go func() {
		if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("Admin API server error: %v", err)
		}
	}()
}

func main() {
	server, err := NewProxyServer(":4242")
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}

	backends := []struct {
		routeID string
		address string
		weight  int
	}{
		{"api", "example.com:80", 3},
		{"api", "example.org:80", 2},
		{"default", "example.com:80", 1},
	}

	for _, b := range backends {
		if err := server.AddBackend(b.routeID, b.address, b.weight); err != nil {
			log.Printf("Failed to add backend %s: %v", b.address, err)
		}
	}

	server.StartHealthCheck()
	log.Println("Health check started")

	server.setupAdminAPI()
	log.Println("Admin API started on :8080")

	log.Println("QUIC Proxy Server starting on :4242")
	log.Fatal(server.Start())
}
