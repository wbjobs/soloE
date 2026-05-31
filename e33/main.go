package main

import (
	"flag"
	"fmt"
	"os"

	"quic-load-tester/config"
	"quic-load-tester/reporter"
	"quic-load-tester/stats"
	"quic-load-tester/tester"
)

func main() {
	configPath := flag.String("config", "config.yaml", "Path to configuration file")
	flag.Parse()

	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		fmt.Printf("Warning: Could not load config file: %v\nUsing default config instead.\n", err)
		cfg = config.DefaultConfig()
	}

	lt := tester.NewLoadTester(cfg)

	fmt.Println("=== QUIC Load Tester Configuration ===")
	fmt.Printf("Server: %s:%d\n", cfg.Server.Host, cfg.Server.Port)
	fmt.Printf("Path: %s\n", cfg.Server.Path)
	fmt.Printf("Method: %s\n", cfg.Server.Method)
	fmt.Printf("Concurrent Connections: %d\n", cfg.Concurrency)
	fmt.Printf("Requests per Second: %d\n", cfg.RequestsPerSec)
	fmt.Printf("Request Body Size: %d bytes\n", cfg.RequestBody)
	if cfg.RequestCount > 0 {
		fmt.Printf("Request Count: %d\n", cfg.RequestCount)
	}
	if cfg.Duration > 0 {
		fmt.Printf("Test Duration: %d seconds\n", cfg.Duration)
	}
	fmt.Printf("Output CSV: %s\n", cfg.OutputFile)
	fmt.Println("======================================")

	if err := lt.Run(); err != nil {
		fmt.Printf("Test failed: %v\n", err)
		os.Exit(1)
	}

	lt.SyncSessionStats()
	metrics := lt.GetMetrics()
	
	printResults(metrics)

	if err := reporter.GenerateCSVReport(cfg.OutputFile, metrics); err != nil {
		fmt.Printf("Failed to generate CSV report: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\nCSV report generated: %s\n", cfg.OutputFile)
}

func printResults(metrics *stats.Metrics) {
	fmt.Println("\n=== Test Results ===")

	connPerc := metrics.GetConnectionTimePercentiles()
	rttPerc := metrics.GetRTTPercentiles()
	avgConnTime, avgRTT := metrics.GetAverages()
	totalReq, failedReq, retrans, lost := metrics.GetCounts()
	connCount := metrics.GetConnectionCount()
	sessionReused, sessionNew, sessionTotal := metrics.GetSessionStats()
	sessionReuseRate := metrics.GetSessionReuseRate()

	fmt.Printf("Total Connections: %d\n", connCount)
	fmt.Printf("Average Connection Time: %.2f ms\n", avgConnTime.Seconds()*1000)
	fmt.Printf("Connection Time P50: %.2f ms\n", connPerc.P50.Seconds()*1000)
	fmt.Printf("Connection Time P95: %.2f ms\n", connPerc.P95.Seconds()*1000)
	fmt.Printf("Connection Time P99: %.2f ms\n", connPerc.P99.Seconds()*1000)

	fmt.Printf("\nTotal Requests: %d\n", totalReq)
	fmt.Printf("Failed Requests: %d\n", failedReq)
	if totalReq > 0 {
		fmt.Printf("Success Rate: %.2f%%\n", float64(totalReq-failedReq)/float64(totalReq)*100)
	}
	fmt.Printf("Average RTT: %.2f ms\n", avgRTT.Seconds()*1000)
	fmt.Printf("RTT P50: %.2f ms\n", rttPerc.P50.Seconds()*1000)
	fmt.Printf("RTT P95: %.2f ms\n", rttPerc.P95.Seconds()*1000)
	fmt.Printf("RTT P99: %.2f ms\n", rttPerc.P99.Seconds()*1000)

	fmt.Printf("\nTotal Retransmissions: %d\n", retrans)
	fmt.Printf("Total Packets Lost: %d\n", lost)
	if totalReq > 0 {
		fmt.Printf("Retransmission Rate: %.4f\n", float64(retrans)/float64(totalReq))
	}

	fmt.Printf("\n=== TLS Session Reuse Stats ===\n")
	fmt.Printf("Total TLS Sessions: %d\n", sessionTotal)
	fmt.Printf("Reused Sessions: %d\n", sessionReused)
	fmt.Printf("New Sessions: %d\n", sessionNew)
	fmt.Printf("Session Reuse Rate: %.2f%%\n", sessionReuseRate)

	fmt.Println("====================")
}
