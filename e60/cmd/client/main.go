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
	"github.com/quic-go/quic-go/qlog"

	"quic-proxy/pkg/common"
)

type ProxyClient struct {
	msc          *common.MultiServerClient
	seamlessProxy *common.SeamlessProxy
	stats        *common.ConnectionStats
	mu           sync.Mutex
}

func NewProxyClient(serverAddrs []string) *ProxyClient {
	servers := make([]*common.ServerConfig, len(serverAddrs))
	for i, addr := range serverAddrs {
		servers[i] = &common.ServerConfig{
			Address:  addr,
			Priority: i + 1,
			TLSConfig: common.GetClientTLSConfig(),
		}
	}

	msc := common.NewMultiServerClient(servers)
	seamlessProxy := common.NewSeamlessProxy(msc, 5*time.Minute)

	return &ProxyClient{
		msc:          msc,
		seamlessProxy: seamlessProxy,
		stats:        common.NewConnectionStats(),
	}
}

func (c *ProxyClient) Connect() error {
	err := c.msc.Connect()
	if err != nil {
		return err
	}

	go c.monitorStatus()
	return nil
}

func (c *ProxyClient) monitorStatus() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		state := c.msc.GetState()
		server := c.msc.GetCurrentServer()
		sessions := c.seamlessProxy.GetSessionManager().GetSessionCount()

		serverAddr := "none"
		if server != nil {
			serverAddr = server.Address
		}

		log.Printf("Client Status - State: %s, Server: %s, Sessions: %d",
			state, serverAddr, sessions)

		conn := c.msc.GetConnection()
		if conn != nil {
			bw, rtt, cwnd, lost := conn.GetBBR().GetStats()
			log.Printf("BBR Stats - BW: %.2f Mbps, RTT: %v, CWND: %d, Lost: %d",
				bw/1e6, rtt, cwnd, lost)
		}
	}
}

func (c *ProxyClient) NewStream(targetAddr string) (quic.Stream, *common.StreamStats, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	stream, err := c.msc.OpenStreamSync(context.Background())
	if err != nil {
		return nil, nil, err
	}

	streamID := uint64(stream.StreamID())
	stats := c.stats.AddStream(streamID)

	if wrapper, ok := stream.(*common.QuicStreamWrapper); ok {
		wrapper.SetPriority(common.PriorityNormal)
	}

	headerBytes := []byte(targetAddr)
	compressedHeader, err := common.CompressBrotli(headerBytes)
	if err != nil {
		stream.Close()
		return nil, nil, err
	}

	headerLen := len(compressedHeader)
	headerLenBuf := []byte{
		byte(headerLen >> 24),
		byte(headerLen >> 16),
		byte(headerLen >> 8),
		byte(headerLen),
	}

	_, err = stream.Write(headerLenBuf)
	if err != nil {
		stream.Close()
		return nil, nil, err
	}
	stats.AddSent(4)

	_, err = stream.Write(compressedHeader)
	if err != nil {
		stream.Close()
		return nil, nil, err
	}
	stats.AddSent(len(compressedHeader))

	log.Printf("New stream %d created for target: %s (priority scheduling enabled)", streamID, targetAddr)
	return stream, stats, nil
}

func (c *ProxyClient) HandleWebSocketSession(wsConn *websocket.Conn, sessionID, targetAddr string) error {
	return c.seamlessProxy.HandleWebSocket(wsConn, sessionID, targetAddr)
}

func (c *ProxyClient) GetMultiServerClient() *common.MultiServerClient {
	return c.msc
}

func (c *ProxyClient) GetSeamlessProxy() *common.SeamlessProxy {
	return c.seamlessProxy
}

func (c *ProxyClient) HandleLocalConnection(localConn net.Conn, targetAddr string) {
	defer localConn.Close()

	stream, stats, err := c.NewStream(targetAddr)
	if err != nil {
		log.Printf("Failed to create stream: %v", err)
		return
	}
	defer stream.Close()
	defer c.stats.RemoveStream(uint64(stream.StreamID()))

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		buf := make([]byte, 32*1024)
		for {
			n, err := localConn.Read(buf)
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

	go func() {
		defer wg.Done()
		buf := make([]byte, 32*1024)
		for {
			n, err := stream.Read(buf)
			if n > 0 {
				stats.AddRecv(n)
				_, writeErr := localConn.Write(buf[:n])
				if writeErr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	wg.Wait()
	sent, recv, duration := stats.GetStats()
	log.Printf("Stream %d completed: sent=%d bytes, recv=%d bytes, duration=%v", stream.StreamID(), sent, recv, duration)
}

func (c *ProxyClient) StartLocalListener(listenAddr, targetAddr string) error {
	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return err
	}
	defer listener.Close()

	log.Printf("Local proxy listening on %s, forwarding to %s via QUIC", listenAddr, targetAddr)

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("Failed to accept local connection: %v", err)
			continue
		}
		go c.HandleLocalConnection(conn, targetAddr)
	}
}

func main() {
	serverAddrs := []string{
		"localhost:4242",
		"localhost:4243",
	}

	client := NewProxyClient(serverAddrs)

	if err := client.Connect(); err != nil {
		log.Printf("Initial connection failed: %v, will retry", err)
	}

	wsProxy := NewWebSocketProxy(client)
	http.Handle("/ws", wsProxy)

	http.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		streams, sent, recv := client.stats.GetTotalStats()
		state := client.GetMultiServerClient().GetState()
		server := client.GetMultiServerClient().GetCurrentServer()
		
		serverAddr := "none"
		if server != nil {
			serverAddr = server.Address
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"state": "` + string(state) + `", "server": "` + serverAddr + `", "streams": ` + string(rune(streams)) + `, "sent": ` + string(rune(sent)) + `, "recv": ` + string(rune(recv)) + `}`))
	})

	http.HandleFunc("/failover/status", func(w http.ResponseWriter, r *http.Request) {
		state := client.GetMultiServerClient().GetState()
		server := client.GetMultiServerClient().GetCurrentServer()
		sessions := client.GetSeamlessProxy().GetSessionManager().GetSessionCount()

		serverAddr := "none"
		if server != nil {
			serverAddr = server.Address
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"state": "` + string(state) + `", "current_server": "` + serverAddr + `", "active_sessions": ` + string(rune(sessions)) + `}`))
	})

	go func() {
		if err := http.ListenAndServe(":8081", nil); err != nil {
			log.Printf("HTTP server error: %v", err)
		}
	}()

	log.Println("Client admin API started on :8081")
	log.Println("Use /ws for WebSocket proxy with session migration")
	log.Println("Use /failover/status to check failover status")

	log.Fatal(client.StartLocalListener(":8082", "/api"))
}
