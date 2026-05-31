package proxy

import (
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	"github.com/nfs-proxy/internal/logger"
	"github.com/nfs-proxy/internal/nfs"
	"github.com/nfs-proxy/internal/rpc"
)

type Proxy struct {
	listener     net.Listener
	backendAddr  string
	logger       *logger.RequestLogger
	activeConns  map[string]net.Conn
	connMu       sync.Mutex
	stats        *Stats
	shutdown     chan struct{}
	wg           sync.WaitGroup
}

type Stats struct {
	mu               sync.Mutex
	RequestsReceived uint64
	RequestsForwarded uint64
	ResponsesSent    uint64
	Errors           uint64
	ProcedureCounts  map[string]uint64
	StartTime        time.Time
}

type Config struct {
	ListenAddr   string
	BackendAddr  string
	Logger       *logger.RequestLogger
}

func NewProxy(cfg Config) (*Proxy, error) {
	listener, err := net.Listen("tcp", cfg.ListenAddr)
	if err != nil {
		return nil, fmt.Errorf("failed to create listener: %w", err)
	}

	return &Proxy{
		listener:    listener,
		backendAddr: cfg.BackendAddr,
		logger:      cfg.Logger,
		activeConns: make(map[string]net.Conn),
		stats: &Stats{
			ProcedureCounts: make(map[string]uint64),
			StartTime:       time.Now(),
		},
		shutdown: make(chan struct{}),
	}, nil
}

func (p *Proxy) Serve() error {
	fmt.Printf("NFS Proxy server listening on %s, forwarding to %s\n",
		p.listener.Addr(), p.backendAddr)

	for {
		select {
		case <-p.shutdown:
			return nil
		default:
		}

		clientConn, err := p.listener.Accept()
		if err != nil {
			select {
			case <-p.shutdown:
				return nil
			default:
				return fmt.Errorf("accept error: %w", err)
			}
		}

		p.wg.Add(1)
		go p.handleConnection(clientConn)
	}
}

func (p *Proxy) handleConnection(clientConn net.Conn) {
	defer p.wg.Done()
	defer clientConn.Close()

	clientAddr := clientConn.RemoteAddr().String()
	p.connMu.Lock()
	p.activeConns[clientAddr] = clientConn
	p.connMu.Unlock()
	defer func() {
		p.connMu.Lock()
		delete(p.activeConns, clientAddr)
		p.connMu.Unlock()
	}()

	backendConn, err := net.DialTimeout("tcp", p.backendAddr, 30*time.Second)
	if err != nil {
		fmt.Printf("Failed to connect to backend %s: %v\n", p.backendAddr, err)
		p.stats.mu.Lock()
		p.stats.Errors++
		p.stats.mu.Unlock()
		return
	}
	defer backendConn.Close()

	errChan := make(chan error, 2)

	go func() {
		errChan <- p.forwardRequests(clientConn, backendConn)
	}()

	go func() {
		errChan <- p.forwardResponses(backendConn, clientConn)
	}()

	<-errChan
}

func (p *Proxy) forwardRequests(client, backend net.Conn) error {
	buf := make([]byte, 1024*1024)

	for {
		select {
		case <-p.shutdown:
			return nil
		default:
		}

		client.SetReadDeadline(time.Now().Add(5 * time.Minute))
		n, err := client.Read(buf)
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("read from client: %w", err)
		}

		msg, err := rpc.ReadRPCMessageFromBytes(buf[:n])
		if err != nil {
			fmt.Printf("Warning: failed to parse RPC request: %v\n", err)
			if _, werr := backend.Write(buf[:n]); werr != nil {
				return fmt.Errorf("write to backend: %w", werr)
			}
			continue
		}

		p.stats.mu.Lock()
		p.stats.RequestsReceived++
		if call, ok := msg.Body.(*rpc.RPCMsgCall); ok {
			procName := nfs.ProcedureName(call.Program, call.Version, call.Procedure)
			p.stats.ProcedureCounts[procName]++
		}
		p.stats.mu.Unlock()

		if p.logger != nil {
			if err := p.logger.LogRequest(msg, "REQUEST"); err != nil {
				fmt.Printf("Warning: failed to log request: %v\n", err)
			}
		}

		if _, werr := backend.Write(buf[:n]); werr != nil {
			return fmt.Errorf("write to backend: %w", werr)
		}

		p.stats.mu.Lock()
		p.stats.RequestsForwarded++
		p.stats.mu.Unlock()
	}
}

func (p *Proxy) forwardResponses(backend, client net.Conn) error {
	buf := make([]byte, 1024*1024)

	for {
		select {
		case <-p.shutdown:
			return nil
		default:
		}

		backend.SetReadDeadline(time.Now().Add(5 * time.Minute))
		n, err := backend.Read(buf)
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("read from backend: %w", err)
		}

		msg, err := rpc.ReadRPCMessageFromBytes(buf[:n])
		if err != nil {
			fmt.Printf("Warning: failed to parse RPC response: %v\n", err)
			if _, werr := client.Write(buf[:n]); werr != nil {
				return fmt.Errorf("write to client: %w", werr)
			}
			continue
		}

		if p.logger != nil {
			if err := p.logger.LogRequest(msg, "RESPONSE"); err != nil {
				fmt.Printf("Warning: failed to log response: %v\n", err)
			}
		}

		if _, werr := client.Write(buf[:n]); werr != nil {
			return fmt.Errorf("write to client: %w", werr)
		}

		p.stats.mu.Lock()
		p.stats.ResponsesSent++
		p.stats.mu.Unlock()
	}
}

func (p *Proxy) Shutdown() error {
	close(p.shutdown)
	p.listener.Close()

	p.connMu.Lock()
	for _, conn := range p.activeConns {
		conn.Close()
	}
	p.connMu.Unlock()

	p.wg.Wait()
	return nil
}

func (p *Proxy) GetStats() *Stats {
	p.stats.mu.Lock()
	defer p.stats.mu.Unlock()

	stats := &Stats{
		RequestsReceived:  p.stats.RequestsReceived,
		RequestsForwarded: p.stats.RequestsForwarded,
		ResponsesSent:     p.stats.ResponsesSent,
		Errors:            p.stats.Errors,
		ProcedureCounts:   make(map[string]uint64),
		StartTime:         p.stats.StartTime,
	}
	for k, v := range p.stats.ProcedureCounts {
		stats.ProcedureCounts[k] = v
	}
	return stats
}

func (s *Stats) Print() {
	s.mu.Lock()
	defer s.mu.Unlock()

	uptime := time.Since(s.StartTime)
	fmt.Println("=== NFS Proxy Statistics ===")
	fmt.Printf("Uptime: %v\n", uptime)
	fmt.Printf("Requests Received:  %d\n", s.RequestsReceived)
	fmt.Printf("Requests Forwarded: %d\n", s.RequestsForwarded)
	fmt.Printf("Responses Sent:     %d\n", s.ResponsesSent)
	fmt.Printf("Errors:             %d\n", s.Errors)
	fmt.Println("\nProcedure Counts:")
	for proc, count := range s.ProcedureCounts {
		fmt.Printf("  %-20s: %d\n", proc, count)
	}
	fmt.Println("============================")
}

func (p *Proxy) Addr() net.Addr {
	return p.listener.Addr()
}
