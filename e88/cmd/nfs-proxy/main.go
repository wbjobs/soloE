package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nfs-proxy/internal/coverage"
	"github.com/nfs-proxy/internal/fuzz"
	"github.com/nfs-proxy/internal/logger"
	"github.com/nfs-proxy/internal/mock"
	"github.com/nfs-proxy/internal/proxy"
	"github.com/nfs-proxy/internal/replay"

	"github.com/spf13/cobra"
)

var (
	listenAddr      string
	backendAddr     string
	logDir          string
	logFilename     string
	enableJSON      bool
	enableRaw       bool
	enableBin       bool
	concurrency     int
	iterations      int
	modifyFH        bool
	modifyOffset    bool
	modifyCount     bool
	modifyAll       bool
	corrupt         bool
	reportFile      string
	useMock         bool
	mockDelay       time.Duration
	fixLog          bool
	fixOutput       string
	dangerousFilter bool
	maxOffset       uint64
	maxCount        uint32
	diffMode        bool
	mockAddr        string
	diffThreshold   float64
	xdrDump         bool
	xdrDumpDir      string
	htmlReport      string
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "nfs-proxy",
		Short: "NFS Proxy Server with logging, replay, and fuzz testing capabilities",
		Long:  "A pure user-space NFS proxy server that intercepts and forwards NFS requests, with logging, replay, and fuzz testing features.",
	}

	rootCmd.AddCommand(newProxyCmd())
	rootCmd.AddCommand(newReplayCmd())
	rootCmd.AddCommand(newFuzzCmd())
	rootCmd.AddCommand(newMockCmd())

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func newProxyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "proxy",
		Short: "Run the NFS proxy server",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runProxy()
		},
	}

	cmd.Flags().StringVarP(&listenAddr, "listen", "l", ":2049", "Listen address")
	cmd.Flags().StringVarP(&backendAddr, "backend", "b", "localhost:2049", "Backend NFS server address")
	cmd.Flags().StringVar(&logDir, "log-dir", "./logs", "Log directory")
	cmd.Flags().StringVar(&logFilename, "log-file", "", "Log filename prefix (default: auto-generated)")
	cmd.Flags().BoolVar(&enableJSON, "log-json", true, "Enable JSON logging")
	cmd.Flags().BoolVar(&enableRaw, "log-raw", true, "Enable raw text logging")
	cmd.Flags().BoolVar(&enableBin, "log-bin", true, "Enable binary logging")

	return cmd
}

func runProxy() error {
	logCfg := logger.Config{
		LogDir:       logDir,
		Filename:     logFilename,
		EnableJSON:   enableJSON,
		EnableRaw:    enableRaw,
		EnableBinary: enableBin,
	}

	reqLogger, err := logger.NewRequestLogger(logCfg)
	if err != nil {
		return fmt.Errorf("failed to create logger: %w", err)
	}
	defer reqLogger.Close()

	fmt.Printf("Log files will be written to: %s\n", reqLogger.Filename())

	proxyCfg := proxy.Config{
		ListenAddr:  listenAddr,
		BackendAddr: backendAddr,
		Logger:      reqLogger,
	}

	p, err := proxy.NewProxy(proxyCfg)
	if err != nil {
		return fmt.Errorf("failed to create proxy: %w", err)
	}
	defer p.Shutdown()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		fmt.Println("\nShutting down...")
		p.Shutdown()
	}()

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			stats := p.GetStats()
			stats.Print()
		}
	}()

	if err := p.Serve(); err != nil {
		return fmt.Errorf("proxy server error: %w", err)
	}

	return nil
}

func newReplayCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "replay [log-file]",
		Short: "Replay NFS requests from a log file",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runReplay(args[0])
		},
	}

	cmd.Flags().StringVarP(&backendAddr, "target", "t", "localhost:2049", "Target NFS server address")
	cmd.Flags().IntVarP(&concurrency, "concurrency", "c", 10, "Number of concurrent requests")
	cmd.Flags().StringVar(&reportFile, "report", "", "Save replay report to file")
	cmd.Flags().BoolVar(&useMock, "use-mock", false, "Use built-in mock server as target")
	cmd.Flags().BoolVar(&fixLog, "fix", false, "Fix corrupted binary log file before replaying")
	cmd.Flags().StringVar(&fixOutput, "fix-output", "", "Output file for fixed log (default: input.log.fixed)")
	cmd.Flags().BoolVar(&diffMode, "diff", false, "Enable semantic difference detection mode")
	cmd.Flags().StringVar(&mockAddr, "mock-addr", "", "Mock server address for diff mode (default: auto-start internal mock)")
	cmd.Flags().Float64Var(&diffThreshold, "diff-threshold", 0.1, "Difference threshold for alert (0.1 = 10%)")
	cmd.Flags().BoolVar(&xdrDump, "xdr-dump", false, "Enable XDR dump for differing requests")
	cmd.Flags().StringVar(&xdrDumpDir, "xdr-dump-dir", "./xdr_dumps", "Directory to store XDR dumps")
	cmd.Flags().StringVar(&htmlReport, "html-report", "", "Generate HTML report to file")

	return cmd
}

func runReplay(logFile string) error {
	targetAddr := backendAddr

	if fixLog {
		fmt.Printf("Fixing corrupted binary log: %s\n", logFile)
		result, err := logger.FixBinaryLog(logFile, fixOutput)
		if err != nil {
			return fmt.Errorf("failed to fix log: %w", err)
		}
		fmt.Printf("Log fix complete:\n")
		fmt.Printf("  Total entries:     %d\n", result.TotalEntries)
		fmt.Printf("  Valid entries:     %d\n", result.ValidEntries)
		fmt.Printf("  Corrupted entries: %d\n", result.CorruptedEntries)
		fmt.Printf("  Recovered entries: %d\n", result.RecoveredEntries)
		if result.OutputFile != "" {
			fmt.Printf("  Fixed log saved to: %s\n", result.OutputFile)
			logFile = result.OutputFile
		}
		if result.ValidEntries == 0 {
			return fmt.Errorf("no valid entries found in log file")
		}
	}

	if diffMode {
		return runDiffDetection(logFile)
	}

	if useMock {
		mockServer := mock.NewMockServer(mock.MockConfig{
			Delay: mockDelay,
		})
		if err := mockServer.Serve(); err != nil {
			return fmt.Errorf("failed to start mock server: %w", err)
		}
		defer mockServer.Shutdown()
		targetAddr = mockServer.Addr().String()
		fmt.Printf("Using mock server at %s\n", targetAddr)
		time.Sleep(100 * time.Millisecond)
	}

	replayer := replay.NewReplayer(replay.ReplayConfig{
		TargetAddr:  targetAddr,
		Timeout:     30 * time.Second,
		Concurrency: concurrency,
	})

	fmt.Printf("Replaying requests from %s to %s with concurrency %d...\n", logFile, targetAddr, concurrency)

	stats, err := replayer.ReplayFromFile(logFile, concurrency)
	if err != nil {
		return fmt.Errorf("replay failed: %w", err)
	}

	stats.Print()

	if reportFile != "" {
		report := stats.GenerateReport()
		if err := os.WriteFile(reportFile, []byte(report), 0644); err != nil {
			return fmt.Errorf("failed to write report: %w", err)
		}
		fmt.Printf("Report saved to %s\n", reportFile)
	}

	return nil
}

func runDiffDetection(logFile string) error {
	realAddr := backendAddr
	mockTargetAddr := mockAddr

	if mockTargetAddr == "" {
		mockServer := mock.NewMockServer(mock.MockConfig{
			Delay: mockDelay,
		})
		if err := mockServer.Serve(); err != nil {
			return fmt.Errorf("failed to start mock server: %w", err)
		}
		defer mockServer.Shutdown()
		mockTargetAddr = mockServer.Addr().String()
		fmt.Printf("Using internal mock server at %s\n", mockTargetAddr)
		time.Sleep(100 * time.Millisecond)
	}

	replayer := replay.NewReplayer(replay.ReplayConfig{
		TargetAddr:  realAddr,
		Timeout:     30 * time.Second,
		Concurrency: concurrency,
	})

	cfg := replay.DiffReplayConfig{
		RealServerAddr: realAddr,
		MockServerAddr: mockTargetAddr,
		Timeout:        30 * time.Second,
		Concurrency:    concurrency,
		DiffThreshold:  diffThreshold,
		EnableXDRDump:  xdrDump,
		XDROutputDir:   xdrDumpDir,
		HTMLReportFile: htmlReport,
	}

	stats, err := replayer.ReplayFromFileWithDiffDetection(logFile, cfg)
	if err != nil {
		return fmt.Errorf("diff detection failed: %w", err)
	}

	stats.Print()

	return nil
}

func newFuzzCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "fuzz [log-file]",
		Short: "Run fuzz tests against NFS server",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runFuzz(args[0])
		},
	}

	cmd.Flags().StringVarP(&backendAddr, "target", "t", "localhost:2049", "Target NFS server address")
	cmd.Flags().IntVarP(&concurrency, "concurrency", "c", 10, "Number of concurrent requests")
	cmd.Flags().IntVarP(&iterations, "iterations", "i", 1000, "Number of fuzz iterations")
	cmd.Flags().BoolVar(&modifyFH, "modify-fh", true, "Modify file handles")
	cmd.Flags().BoolVar(&modifyOffset, "modify-offset", true, "Modify offset fields")
	cmd.Flags().BoolVar(&modifyCount, "modify-count", true, "Modify count fields")
	cmd.Flags().BoolVar(&modifyAll, "modify-all", false, "Modify all fields (overrides individual flags)")
	cmd.Flags().BoolVar(&corrupt, "corrupt", false, "Corrupt payload bytes")
	cmd.Flags().StringVar(&reportFile, "report", "", "Save fuzz report to file")
	cmd.Flags().BoolVar(&useMock, "use-mock", false, "Use built-in mock server as target")
	cmd.Flags().BoolVar(&dangerousFilter, "dangerous-filter", false, "Enable dangerous operation filtering (prevents negative offsets, limits size)")
	cmd.Flags().Uint64Var(&maxOffset, "max-offset", 1<<40, "Maximum offset value when dangerous filter is enabled (default: 1TB)")
	cmd.Flags().Uint32Var(&maxCount, "max-count", 1<<20, "Maximum count value when dangerous filter is enabled (default: 1MB)")

	return cmd
}

func runFuzz(logFile string) error {
	targetAddr := backendAddr

	if useMock {
		mockServer := mock.NewMockServer(mock.MockConfig{
			Delay: mockDelay,
		})
		if err := mockServer.Serve(); err != nil {
			return fmt.Errorf("failed to start mock server: %w", err)
		}
		defer mockServer.Shutdown()
		targetAddr = mockServer.Addr().String()
		fmt.Printf("Using mock server at %s\n", targetAddr)
		time.Sleep(100 * time.Millisecond)
	}

	messages, err := logger.ReadBinaryEntries(logFile)
	if err != nil {
		messages, err = logger.ReadJSONEntries(logFile)
		if err != nil {
			return fmt.Errorf("failed to read log file: %w", err)
		}
	}

	fmt.Printf("Loaded %d base messages from log file\n", len(messages))

	if modifyAll {
		modifyFH = true
		modifyOffset = true
		modifyCount = true
	}

	fuzzer := fuzz.NewFuzzer(fuzz.FuzzConfig{
		TargetAddr:            targetAddr,
		Timeout:               10 * time.Second,
		Concurrency:           concurrency,
		Iterations:            iterations,
		ModifyFileHandle:      modifyFH,
		ModifyOffset:          modifyOffset,
		ModifyCount:           modifyCount,
		ModifyAllFields:       modifyAll,
		CorruptPayload:        corrupt,
		EnableDangerousFilter: dangerousFilter,
		MaxOffset:             maxOffset,
		MaxCount:              maxCount,
	})

	fmt.Printf("Running %d fuzz iterations against %s with concurrency %d...\n", iterations, targetAddr, concurrency)

	stats, err := fuzzer.Fuzz(messages)
	if err != nil {
		return fmt.Errorf("fuzz testing failed: %w", err)
	}

	stats.Print()

	if reportFile != "" {
		report := stats.GenerateReport()
		if err := os.WriteFile(reportFile, []byte(report), 0644); err != nil {
			return fmt.Errorf("failed to write report: %w", err)
		}
		fmt.Printf("Report saved to %s\n", reportFile)
	}

	return nil
}

func newMockCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "mock",
		Short: "Run a mock NFS server for testing",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runMock()
		},
	}

	cmd.Flags().StringVarP(&listenAddr, "listen", "l", ":2049", "Listen address")
	cmd.Flags().DurationVar(&mockDelay, "delay", 0, "Artificial response delay")

	return cmd
}

func runMock() error {
	mockServer := mock.NewMockServer(mock.MockConfig{
		ListenAddr: listenAddr,
		Delay:      mockDelay,
	})

	if err := mockServer.Serve(); err != nil {
		return fmt.Errorf("failed to start mock server: %w", err)
	}
	defer mockServer.Shutdown()

	fmt.Printf("Mock NFS server running at %s\n", mockServer.Addr())

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			stats := mockServer.GetStats()
			stats.Print()
		}
	}()

	<-sigChan
	fmt.Println("\nShutting down mock server...")

	return nil
}
