package fuzz

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"math"
	"math/big"
	"net"
	"sync"
	"time"

	"github.com/nfs-proxy/internal/nfs"
	"github.com/nfs-proxy/internal/rpc"
	"github.com/nfs-proxy/internal/xdr"
)

type Fuzzer struct {
	targetAddr string
	timeout    time.Duration
	config     FuzzConfig
	stats      *FuzzStats
}

type FuzzConfig struct {
	TargetAddr               string
	Timeout                  time.Duration
	Concurrency              int
	Iterations               int
	ModifyFileHandle         bool
	ModifyOffset             bool
	ModifyCount              bool
	ModifyAllFields          bool
	CorruptPayload           bool
	EnableDangerousFilter    bool
	MaxOffset                uint64
	MaxCount                 uint32
}

type FuzzStats struct {
	mu                  sync.Mutex
	TotalIterations     uint64
	Successful          uint64
	Failed              uint64
	Crashes             uint64
	UnexpectedResponses uint64
	ProcedureStats      map[string]*FuzzProcedureStat
	StartTime           time.Time
	CrashDetails        []CrashDetail
}

type FuzzProcedureStat struct {
	Count     uint64
	Success   uint64
	Failed    uint64
	Crash     uint64
}

type CrashDetail struct {
	Timestamp time.Time
	Procedure string
	Error     string
	Request   []byte
	Response  []byte
}

type FuzzResult struct {
	Success    bool
	Crash      bool
	Error      error
	Duration   time.Duration
	Procedure  string
	Modified   []string
}

func NewFuzzer(cfg FuzzConfig) *Fuzzer {
	if cfg.Timeout == 0 {
		cfg.Timeout = 10 * time.Second
	}
	if cfg.Concurrency == 0 {
		cfg.Concurrency = 1
	}
	if cfg.Iterations == 0 {
		cfg.Iterations = 1000
	}

	return &Fuzzer{
		targetAddr: cfg.TargetAddr,
		timeout:    cfg.Timeout,
		config:     cfg,
		stats: &FuzzStats{
			ProcedureStats: make(map[string]*FuzzProcedureStat),
			StartTime:      time.Now(),
			CrashDetails:   make([]CrashDetail, 0),
		},
	}
}

func (f *Fuzzer) Fuzz(baseMessages []*rpc.RPCMsg) (*FuzzStats, error) {
	if len(baseMessages) == 0 {
		return nil, fmt.Errorf("no base messages provided")
	}

	f.stats.StartTime = time.Now()
	sem := make(chan struct{}, f.config.Concurrency)
	var wg sync.WaitGroup

	for i := 0; i < f.config.Iterations; i++ {
		baseMsg := baseMessages[i%len(baseMessages)]

		sem <- struct{}{}
		wg.Add(1)

		go func(msg *rpc.RPCMsg, iteration int) {
			defer wg.Done()
			defer func() { <-sem }()

			fuzzedMsg, modified := f.fuzzMessage(msg)
			result := f.sendFuzzedRequest(fuzzedMsg, modified)
			f.updateStats(result)
		}(baseMsg, i)
	}

	wg.Wait()

	return f.stats, nil
}

func (f *Fuzzer) fuzzMessage(msg *rpc.RPCMsg) (*rpc.RPCMsg, []string) {
	fuzzed := &rpc.RPCMsg{
		Xid:     msg.Xid,
		MsgType: msg.MsgType,
	}

	var modified []string

	if call, ok := msg.Body.(*rpc.RPCMsgCall); ok {
		fuzzedCall := &rpc.RPCMsgCall{
			RPCVersion: call.RPCVersion,
			Program:    call.Program,
			Version:    call.Version,
			Procedure:  call.Procedure,
			Cred:       call.Cred,
			Verf:       call.Verf,
			Body:       make([]byte, len(call.Body)),
		}
		copy(fuzzedCall.Body, call.Body)

		if f.config.ModifyFileHandle || f.config.ModifyAllFields {
			if modifiedFH, ok := f.modifyFileHandle(fuzzedCall.Body); ok {
				fuzzedCall.Body = modifiedFH
				modified = append(modified, "filehandle")
			}
		}

		if f.config.ModifyOffset || f.config.ModifyAllFields {
			if modifiedOffset, ok := f.modifyOffset(fuzzedCall.Body); ok {
				fuzzedCall.Body = modifiedOffset
				modified = append(modified, "offset")
			}
		}

		if f.config.ModifyCount || f.config.ModifyAllFields {
			if modifiedCount, ok := f.modifyCount(fuzzedCall.Body); ok {
				fuzzedCall.Body = modifiedCount
				modified = append(modified, "count")
			}
		}

		if f.config.CorruptPayload {
			if corrupted, ok := f.corruptPayload(fuzzedCall.Body); ok {
				fuzzedCall.Body = corrupted
				modified = append(modified, "payload")
			}
		}

		fuzzed.Body = fuzzedCall
	}

	return fuzzed, modified
}

func (f *Fuzzer) modifyFileHandle(body []byte) ([]byte, bool) {
	if len(body) < 4 {
		return body, false
	}

	fhLen := int(binaryBigEndianUint32(body[0:4]))
	if fhLen <= 0 || fhLen+4 > len(body) {
		return body, false
	}

	fhStart := 4
	fhEnd := fhStart + fhLen

	newFH := make([]byte, fhLen)
	rand.Read(newFH)

	newBody := make([]byte, len(body))
	copy(newBody, body)
	copy(newBody[fhStart:fhEnd], newFH)

	return newBody, true
}

func (f *Fuzzer) modifyOffset(body []byte) ([]byte, bool) {
	if len(body) < 16 {
		return body, false
	}

	offsetPos := len(body) - 16
	newOffset := randomUint64()

	if f.config.EnableDangerousFilter {
		if f.config.MaxOffset > 0 {
			newOffset = newOffset % f.config.MaxOffset
		}
	}

	newBody := make([]byte, len(body))
	copy(newBody, body)
	binary.BigEndian.PutUint64(newBody[offsetPos:offsetPos+8], newOffset)

	return newBody, true
}

func (f *Fuzzer) modifyCount(body []byte) ([]byte, bool) {
	if len(body) < 8 {
		return body, false
	}

	countPos := len(body) - 8
	newCount := randomUint32()

	if f.config.EnableDangerousFilter {
		if f.config.MaxCount > 0 {
			newCount = newCount % f.config.MaxCount
		}
	}

	newBody := make([]byte, len(body))
	copy(newBody, body)
	binary.BigEndian.PutUint32(newBody[countPos:countPos+4], newCount)

	return newBody, true
}

func (f *Fuzzer) corruptPayload(body []byte) ([]byte, bool) {
	if len(body) == 0 {
		return body, false
	}

	numBytes := randIntn(min(10, len(body))) + 1

	newBody := make([]byte, len(body))
	copy(newBody, body)

	for i := 0; i < numBytes; i++ {
		pos := randIntn(len(body))
		newBody[pos] = byte(randIntn(256))
	}

	return newBody, true
}

func (f *Fuzzer) sendFuzzedRequest(msg *rpc.RPCMsg, modified []string) *FuzzResult {
	result := &FuzzResult{
		Modified: modified,
	}

	if call, ok := msg.Body.(*rpc.RPCMsgCall); ok {
		result.Procedure = nfs.ProcedureName(call.Program, call.Version, call.Procedure)
	}

	start := time.Now()

	conn, err := net.DialTimeout("tcp", f.targetAddr, f.timeout)
	if err != nil {
		result.Error = fmt.Errorf("connection failed: %w", err)
		result.Success = false
		result.Crash = true
		result.Duration = time.Since(start)
		return result
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(f.timeout))

	msgData, err := rpc.WriteRPCMessageToBytes(msg)
	if err != nil {
		result.Error = fmt.Errorf("serialization failed: %w", err)
		result.Success = false
		result.Duration = time.Since(start)
		return result
	}

	if _, err := conn.Write(msgData); err != nil {
		result.Error = fmt.Errorf("send failed: %w", err)
		result.Success = false
		result.Crash = true
		result.Duration = time.Since(start)
		return result
	}

	buf := make([]byte, 1024*1024)
	n, err := conn.Read(buf)
	if err != nil {
		result.Error = fmt.Errorf("read failed: %w", err)
		result.Success = false
		result.Crash = true
		result.Duration = time.Since(start)
		f.addCrashDetail(result.Procedure, result.Error.Error(), msgData, buf[:n])
		return result
	}

	_, err = rpc.ReadRPCMessageFromBytes(buf[:n])
	if err != nil {
		result.Error = fmt.Errorf("parse failed: %w", err)
		result.Success = false
		result.Duration = time.Since(start)
		return result
	}

	result.Success = true
	result.Duration = time.Since(start)
	return result
}

func (f *Fuzzer) updateStats(result *FuzzResult) {
	f.stats.mu.Lock()
	defer f.stats.mu.Unlock()

	f.stats.TotalIterations++
	if result.Success {
		f.stats.Successful++
	} else {
		f.stats.Failed++
		if result.Crash {
			f.stats.Crashes++
		} else {
			f.stats.UnexpectedResponses++
		}
	}

	ps, ok := f.stats.ProcedureStats[result.Procedure]
	if !ok {
		ps = &FuzzProcedureStat{}
		f.stats.ProcedureStats[result.Procedure] = ps
	}
	ps.Count++
	if result.Success {
		ps.Success++
	} else {
		ps.Failed++
		if result.Crash {
			ps.Crash++
		}
	}
}

func (f *Fuzzer) addCrashDetail(procedure, err string, request, response []byte) {
	f.stats.mu.Lock()
	defer f.stats.mu.Unlock()

	if len(f.stats.CrashDetails) < 100 {
		f.stats.CrashDetails = append(f.stats.CrashDetails, CrashDetail{
			Timestamp: time.Now(),
			Procedure: procedure,
			Error:     err,
			Request:   request,
			Response:  response,
		})
	}
}

func (s *FuzzStats) Print() {
	s.mu.Lock()
	defer s.mu.Unlock()

	duration := time.Since(s.StartTime)
	fmt.Println("=== Fuzz Testing Statistics ===")
	fmt.Printf("Total Duration:    %v\n", duration)
	fmt.Printf("Total Iterations:  %d\n", s.TotalIterations)
	fmt.Printf("Successful:        %d (%.2f%%)\n", s.Successful,
		float64(s.Successful)/float64(s.TotalIterations)*100)
	fmt.Printf("Failed:            %d (%.2f%%)\n", s.Failed,
		float64(s.Failed)/float64(s.TotalIterations)*100)
	fmt.Printf("Crashes:           %d (%.2f%%)\n", s.Crashes,
		float64(s.Crashes)/float64(s.TotalIterations)*100)
	fmt.Printf("Unexpected Resp:   %d (%.2f%%)\n", s.UnexpectedResponses,
		float64(s.UnexpectedResponses)/float64(s.TotalIterations)*100)

	if duration > 0 {
		fmt.Printf("Throughput:        %.2f req/s\n",
			float64(s.TotalIterations)/duration.Seconds())
	}

	fmt.Println("\nProcedure Breakdown:")
	fmt.Printf("  %-20s %8s %8s %8s %8s\n",
		"Procedure", "Count", "Success", "Failed", "Crash")
	for proc, ps := range s.ProcedureStats {
		fmt.Printf("  %-20s %8d %8d %8d %8d\n",
			proc, ps.Count, ps.Success, ps.Failed, ps.Crash)
	}

	if len(s.CrashDetails) > 0 {
		fmt.Println("\nRecent Crashes:")
		for i, cd := range s.CrashDetails {
			if i >= 5 {
				fmt.Printf("  ... and %d more\n", len(s.CrashDetails)-5)
				break
			}
			fmt.Printf("  [%s] %s: %s\n", cd.Timestamp.Format(time.RFC3339), cd.Procedure, cd.Error)
		}
	}
	fmt.Println("===============================")
}

func (s *FuzzStats) GenerateReport() string {
	s.mu.Lock()
	defer s.mu.Unlock()

	duration := time.Since(s.StartTime)
	report := "=== NFS Fuzz Testing Report ===\n"
	report += fmt.Sprintf("Generated at: %s\n", time.Now().Format(time.RFC3339))
	report += fmt.Sprintf("Total Duration: %v\n", duration)
	report += fmt.Sprintf("Total Iterations: %d\n", s.TotalIterations)
	report += fmt.Sprintf("Successful: %d (%.2f%%)\n", s.Successful,
		float64(s.Successful)/float64(s.TotalIterations)*100)
	report += fmt.Sprintf("Failed: %d (%.2f%%)\n", s.Failed,
		float64(s.Failed)/float64(s.TotalIterations)*100)
	report += fmt.Sprintf("Crashes: %d (%.2f%%)\n", s.Crashes,
		float64(s.Crashes)/float64(s.TotalIterations)*100)
	report += fmt.Sprintf("Unexpected Responses: %d (%.2f%%)\n", s.UnexpectedResponses,
		float64(s.UnexpectedResponses)/float64(s.TotalIterations)*100)

	if duration > 0 {
		report += fmt.Sprintf("Throughput: %.2f req/s\n",
			float64(s.TotalIterations)/duration.Seconds())
	}

	report += "\nProcedure Breakdown:\n"
	for proc, ps := range s.ProcedureStats {
		report += fmt.Sprintf("  %s: count=%d success=%d failed=%d crash=%d\n",
			proc, ps.Count, ps.Success, ps.Failed, ps.Crash)
	}

	if len(s.CrashDetails) > 0 {
		report += "\nCrash Details:\n"
		for i, cd := range s.CrashDetails {
			report += fmt.Sprintf("  Crash %d [%s] %s: %s\n",
				i+1, cd.Timestamp.Format(time.RFC3339), cd.Procedure, cd.Error)
		}
	}
	report += "===============================\n"
	return report
}

func randomUint32() uint32 {
	n, _ := rand.Int(rand.Reader, big.NewInt(math.MaxUint32))
	return uint32(n.Uint64())
}

func randomUint64() uint64 {
	n, _ := rand.Int(rand.Reader, big.NewInt(math.MaxUint64))
	return n.Uint64()
}

func randIntn(n int) int {
	nBig, _ := rand.Int(rand.Reader, big.NewInt(int64(n)))
	return int(nBig.Int64())
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func binaryBigEndianUint32(b []byte) uint32 {
	return binary.BigEndian.Uint32(b)
}
