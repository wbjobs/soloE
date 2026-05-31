package replay

import (
	"context"
	"fmt"
	"net"
	"os"
	"sync"
	"time"

	"github.com/nfs-proxy/internal/diffdetector"
	"github.com/nfs-proxy/internal/logger"
	"github.com/nfs-proxy/internal/nfs"
	"github.com/nfs-proxy/internal/rpc"
)

type Replayer struct {
	targetAddr string
	timeout    time.Duration
	stats      *ReplayStats
}

type ReplayStats struct {
	mu             sync.Mutex
	TotalRequests  uint64
	Successful     uint64
	Failed         uint64
	TotalDuration  time.Duration
	ProcedureStats map[string]*ProcedureStat
	StartTime      time.Time
}

type ProcedureStat struct {
	Count     uint64
	Success   uint64
	Failed    uint64
	MinTime   time.Duration
	MaxTime   time.Duration
	TotalTime time.Duration
}

type ReplayConfig struct {
	TargetAddr  string
	Timeout     time.Duration
	Concurrency int
}

type ReplayResult struct {
	Message    string
	Success    bool
	Error      error
	Duration   time.Duration
	Xid        uint32
	Procedure  string
}

func NewReplayer(cfg ReplayConfig) *Replayer {
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}

	return &Replayer{
		targetAddr: cfg.TargetAddr,
		timeout:    cfg.Timeout,
		stats: &ReplayStats{
			ProcedureStats: make(map[string]*ProcedureStat),
			StartTime:      time.Now(),
		},
	}
}

func (r *Replayer) ReplayFromFile(filename string, concurrency int) (*ReplayStats, error) {
	messages, err := logger.ReadBinaryEntries(filename)
	if err != nil {
		messages, err = logger.ReadJSONEntries(filename)
		if err != nil {
			return nil, fmt.Errorf("failed to read log file: %w", err)
		}
	}

	return r.ReplayMessages(messages, concurrency)
}

func (r *Replayer) ReplayMessages(messages []*rpc.RPCMsg, concurrency int) (*ReplayStats, error) {
	if concurrency <= 0 {
		concurrency = 1
	}

	r.stats.StartTime = time.Now()
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	resultChan := make(chan *ReplayResult, len(messages))

	for _, msg := range messages {
		if _, ok := msg.Body.(*rpc.RPCMsgCall); !ok {
			continue
		}

		sem <- struct{}{}
		wg.Add(1)

		go func(m *rpc.RPCMsg) {
			defer wg.Done()
			defer func() { <-sem }()

			result := r.sendRequest(m)
			resultChan <- result
			r.updateStats(result)
		}(msg)
	}

	wg.Wait()
	close(resultChan)

	r.stats.TotalDuration = time.Since(r.stats.StartTime)
	return r.stats, nil
}

type DiffReplayConfig struct {
	RealServerAddr string
	MockServerAddr string
	Timeout       time.Duration
	Concurrency   int
	DiffThreshold float64
	EnableXDRDump bool
	XDROutputDir  string
	HTMLReportFile string
}

func (r *Replayer) ReplayWithDiffDetection(messages []*rpc.RPCMsg, cfg DiffReplayConfig) (*diffdetector.DiffStats, error) {
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 1
	}
	if cfg.DiffThreshold == 0 {
		cfg.DiffThreshold = 0.1
	}

	detector := diffdetector.NewDiffDetector(diffdetector.DiffConfig{
		RealServerAddr: cfg.RealServerAddr,
		MockServerAddr: cfg.MockServerAddr,
		Timeout:        cfg.Timeout,
		DiffThreshold:  cfg.DiffThreshold,
		EnableXDRDump:  cfg.EnableXDRDump,
	})
	if cfg.EnableXDRDump && cfg.XDROutputDir != "" {
		detector.SetDumpDir(cfg.XDROutputDir)
	}

	sem := make(chan struct{}, cfg.Concurrency)
	var wg sync.WaitGroup

	fmt.Printf("Running semantic difference detection...\n")
	fmt.Printf("Real server: %s\n", cfg.RealServerAddr)
	fmt.Printf("Mock server: %s\n", cfg.MockServerAddr)
	fmt.Printf("Concurrency: %d\n", cfg.Concurrency)
	fmt.Printf("Diff threshold: %.2f%%\n", cfg.DiffThreshold*100)

	for _, msg := range messages {
		if _, ok := msg.Body.(*rpc.RPCMsgCall); !ok {
			continue
		}

		sem <- struct{}{}
		wg.Add(1)

		go func(m *rpc.RPCMsg) {
			defer wg.Done()
			defer func() { <-sem }()

			detector.Detect(m)
		}(msg)
	}

	wg.Wait()

	stats := detector.GetStats()

	if cfg.HTMLReportFile != "" {
		if err := stats.GenerateHTMLReport(cfg.HTMLReportFile); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to generate HTML report: %v\n", err)
		} else {
			fmt.Printf("HTML report saved to: %s\n", cfg.HTMLReportFile)
		}
	}

	return stats, nil
}

func (r *Replayer) ReplayFromFileWithDiffDetection(filename string, cfg DiffReplayConfig) (*diffdetector.DiffStats, error) {
	messages, err := logger.ReadBinaryEntries(filename)
	if err != nil {
		messages, err = logger.ReadJSONEntries(filename)
		if err != nil {
			return nil, fmt.Errorf("failed to read log file: %w", err)
		}
	}

	return r.ReplayWithDiffDetection(messages, cfg)
}

func (r *Replayer) sendRequest(msg *rpc.RPCMsg) *ReplayResult {
	result := &ReplayResult{
		Xid: msg.Xid,
	}

	if call, ok := msg.Body.(*rpc.RPCMsgCall); ok {
		result.Procedure = nfs.ProcedureName(call.Program, call.Version, call.Procedure)
	}

	start := time.Now()

	conn, err := net.DialTimeout("tcp", r.targetAddr, r.timeout)
	if err != nil {
		result.Error = fmt.Errorf("failed to connect: %w", err)
		result.Success = false
		result.Duration = time.Since(start)
		result.Message = fmt.Sprintf("Connection failed: %v", err)
		return result
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(r.timeout))

	msgData, err := rpc.WriteRPCMessageToBytes(msg)
	if err != nil {
		result.Error = fmt.Errorf("failed to serialize message: %w", err)
		result.Success = false
		result.Duration = time.Since(start)
		result.Message = fmt.Sprintf("Serialization failed: %v", err)
		return result
	}

	if _, err := conn.Write(msgData); err != nil {
		result.Error = fmt.Errorf("failed to send request: %w", err)
		result.Success = false
		result.Duration = time.Since(start)
		result.Message = fmt.Sprintf("Send failed: %v", err)
		return result
	}

	buf := make([]byte, 1024*1024)
	n, err := conn.Read(buf)
	if err != nil {
		result.Error = fmt.Errorf("failed to read response: %w", err)
		result.Success = false
		result.Duration = time.Since(start)
		result.Message = fmt.Sprintf("Read failed: %v", err)
		return result
	}

	_, err = rpc.ReadRPCMessageFromBytes(buf[:n])
	if err != nil {
		result.Error = fmt.Errorf("failed to parse response: %w", err)
		result.Success = false
		result.Duration = time.Since(start)
		result.Message = fmt.Sprintf("Parse failed: %v", err)
		return result
	}

	result.Success = true
	result.Duration = time.Since(start)
	result.Message = "Success"

	return result
}

func (r *Replayer) updateStats(result *ReplayResult) {
	r.stats.mu.Lock()
	defer r.stats.mu.Unlock()

	r.stats.TotalRequests++
	if result.Success {
		r.stats.Successful++
	} else {
		r.stats.Failed++
	}

	ps, ok := r.stats.ProcedureStats[result.Procedure]
	if !ok {
		ps = &ProcedureStat{}
		r.stats.ProcedureStats[result.Procedure] = ps
	}
	ps.Count++
	if result.Success {
		ps.Success++
	} else {
		ps.Failed++
	}
	if ps.MinTime == 0 || result.Duration < ps.MinTime {
		ps.MinTime = result.Duration
	}
	if result.Duration > ps.MaxTime {
		ps.MaxTime = result.Duration
	}
	ps.TotalTime += result.Duration
}

func (s *ReplayStats) Print() {
	s.mu.Lock()
	defer s.mu.Unlock()

	fmt.Println("=== Replay Statistics ===")
	fmt.Printf("Total Duration:   %v\n", s.TotalDuration)
	fmt.Printf("Total Requests:   %d\n", s.TotalRequests)
	fmt.Printf("Successful:       %d (%.2f%%)\n", s.Successful,
		float64(s.Successful)/float64(s.TotalRequests)*100)
	fmt.Printf("Failed:           %d (%.2f%%)\n", s.Failed,
		float64(s.Failed)/float64(s.TotalRequests)*100)

	if s.TotalDuration > 0 {
		fmt.Printf("Throughput:       %.2f req/s\n",
			float64(s.TotalRequests)/s.TotalDuration.Seconds())
	}

	fmt.Println("\nProcedure Breakdown:")
	fmt.Printf("  %-20s %8s %8s %8s %12s %12s %12s\n",
		"Procedure", "Count", "Success", "Failed", "Min", "Max", "Avg")
	for proc, ps := range s.ProcedureStats {
		avg := time.Duration(0)
		if ps.Count > 0 {
			avg = ps.TotalTime / time.Duration(ps.Count)
		}
		fmt.Printf("  %-20s %8d %8d %8d %12v %12v %12v\n",
			proc, ps.Count, ps.Success, ps.Failed, ps.MinTime, ps.MaxTime, avg)
	}
	fmt.Println("==========================")
}

func (s *ReplayStats) GenerateReport() string {
	s.mu.Lock()
	defer s.mu.Unlock()

	report := "=== NFS Replay Report ===\n"
	report += fmt.Sprintf("Generated at: %s\n", time.Now().Format(time.RFC3339))
	report += fmt.Sprintf("Total Duration: %v\n", s.TotalDuration)
	report += fmt.Sprintf("Total Requests: %d\n", s.TotalRequests)
	report += fmt.Sprintf("Successful: %d (%.2f%%)\n", s.Successful,
		float64(s.Successful)/float64(s.TotalRequests)*100)
	report += fmt.Sprintf("Failed: %d (%.2f%%)\n", s.Failed,
		float64(s.Failed)/float64(s.TotalRequests)*100)

	if s.TotalDuration > 0 {
		report += fmt.Sprintf("Throughput: %.2f req/s\n",
			float64(s.TotalRequests)/s.TotalDuration.Seconds())
	}

	report += "\nProcedure Breakdown:\n"
	for proc, ps := range s.ProcedureStats {
		avg := time.Duration(0)
		if ps.Count > 0 {
			avg = ps.TotalTime / time.Duration(ps.Count)
		}
		report += fmt.Sprintf("  %s: count=%d success=%d failed=%d min=%v max=%v avg=%v\n",
			proc, ps.Count, ps.Success, ps.Failed, ps.MinTime, ps.MaxTime, avg)
	}
	report += "==========================\n"
	return report
}

func (r *Replayer) ReplayFromFileWithContext(ctx context.Context, filename string, concurrency int) (*ReplayStats, error) {
	messages, err := logger.ReadBinaryEntries(filename)
	if err != nil {
		messages, err = logger.ReadJSONEntries(filename)
		if err != nil {
			return nil, fmt.Errorf("failed to read log file: %w", err)
		}
	}

	return r.ReplayMessagesWithContext(ctx, messages, concurrency)
}

func (r *Replayer) ReplayMessagesWithContext(ctx context.Context, messages []*rpc.RPCMsg, concurrency int) (*ReplayStats, error) {
	if concurrency <= 0 {
		concurrency = 1
	}

	r.stats.StartTime = time.Now()
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	resultChan := make(chan *ReplayResult, len(messages))

	for _, msg := range messages {
		if _, ok := msg.Body.(*rpc.RPCMsgCall); !ok {
			continue
		}

		select {
		case <-ctx.Done():
			wg.Wait()
			close(resultChan)
			r.stats.TotalDuration = time.Since(r.stats.StartTime)
			return r.stats, ctx.Err()
		case sem <- struct{}{}:
		}

		wg.Add(1)
		go func(m *rpc.RPCMsg) {
			defer wg.Done()
			defer func() { <-sem }()

			result := r.sendRequest(m)
			resultChan <- result
			r.updateStats(result)
		}(msg)
	}

	wg.Wait()
	close(resultChan)

	r.stats.TotalDuration = time.Since(r.stats.StartTime)
	return r.stats, nil
}

type DiffReplayConfig struct {
	RealServerAddr string
	MockServerAddr string
	Timeout       time.Duration
	Concurrency   int
	DiffThreshold float64
	EnableXDRDump bool
	XDROutputDir  string
	HTMLReportFile string
}

func (r *Replayer) ReplayWithDiffDetection(messages []*rpc.RPCMsg, cfg DiffReplayConfig) (*diffdetector.DiffStats, error) {
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 1
	}
	if cfg.DiffThreshold == 0 {
		cfg.DiffThreshold = 0.1
	}

	detector := diffdetector.NewDiffDetector(diffdetector.DiffConfig{
		RealServerAddr: cfg.RealServerAddr,
		MockServerAddr: cfg.MockServerAddr,
		Timeout:        cfg.Timeout,
		DiffThreshold:  cfg.DiffThreshold,
		EnableXDRDump:  cfg.EnableXDRDump,
	})
	if cfg.EnableXDRDump && cfg.XDROutputDir != "" {
		detector.SetDumpDir(cfg.XDROutputDir)
	}

	sem := make(chan struct{}, cfg.Concurrency)
	var wg sync.WaitGroup

	fmt.Printf("Running semantic difference detection...\n")
	fmt.Printf("Real server: %s\n", cfg.RealServerAddr)
	fmt.Printf("Mock server: %s\n", cfg.MockServerAddr)
	fmt.Printf("Concurrency: %d\n", cfg.Concurrency)
	fmt.Printf("Diff threshold: %.2f%%\n", cfg.DiffThreshold*100)

	for _, msg := range messages {
		if _, ok := msg.Body.(*rpc.RPCMsgCall); !ok {
			continue
		}

		sem <- struct{}{}
		wg.Add(1)

		go func(m *rpc.RPCMsg) {
			defer wg.Done()
			defer func() { <-sem }()

			detector.Detect(m)
		}(msg)
	}

	wg.Wait()

	stats := detector.GetStats()

	if cfg.HTMLReportFile != "" {
		if err := stats.GenerateHTMLReport(cfg.HTMLReportFile); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to generate HTML report: %v\n", err)
		} else {
			fmt.Printf("HTML report saved to: %s\n", cfg.HTMLReportFile)
		}
	}

	return stats, nil
}

func (r *Replayer) ReplayFromFileWithDiffDetection(filename string, cfg DiffReplayConfig) (*diffdetector.DiffStats, error) {
	messages, err := logger.ReadBinaryEntries(filename)
	if err != nil {
		messages, err = logger.ReadJSONEntries(filename)
		if err != nil {
			return nil, fmt.Errorf("failed to read log file: %w", err)
		}
	}

	return r.ReplayWithDiffDetection(messages, cfg)
}
