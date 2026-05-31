package cmd

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"mqtt-load-tester/internal/config"
	"mqtt-load-tester/internal/mqtt"
	"mqtt-load-tester/internal/report"
	"mqtt-load-tester/internal/server"
	"mqtt-load-tester/internal/stats"
	"mqtt-load-tester/internal/timeseries"
)

var runCmd = &cobra.Command{
	Use:   "run",
	Short: "Run the MQTT load test",
	Long:  `Start the MQTT load test with the specified configuration. This will connect multiple clients, start publishing messages, and collect statistics.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		configPath, _ := cmd.Flags().GetString("config")

		cfg, err := config.LoadConfig(configPath)
		if err != nil {
			return fmt.Errorf("failed to load config: %w", err)
		}

		printConfig(cfg)

		statistics := stats.NewStatistics()
		failureStats := stats.NewFailureInjectionStats()
		timeSeries := timeseries.NewTimeSeriesStore(1000)

		clientMgr := mqtt.NewClientManager(cfg, statistics, failureStats)
		clientMgr.SetMaxConcurrentConnects(cfg.Clients.MaxConcurrentConnects)
		clientMgr.SetConnectDelay(cfg.Clients.ConnectDelay)

		fmt.Printf("Connecting MQTT clients (max concurrent: %d, connect delay: %v)...\n",
			cfg.Clients.MaxConcurrentConnects, cfg.Clients.ConnectDelay)
		if err := clientMgr.Connect(); err != nil {
			return fmt.Errorf("failed to connect clients: %w", err)
		}
		defer clientMgr.Disconnect()

		var httpServer *server.HTTPServer
		if cfg.HTTPServer.Enabled {
			httpServer = server.NewHTTPServer(clientMgr, statistics, timeSeries)
			if err := httpServer.Start(cfg.HTTPServer.Host, cfg.HTTPServer.Port); err != nil {
				return fmt.Errorf("failed to start HTTP server: %w", err)
			}
			defer httpServer.Stop()
			fmt.Printf("Web Dashboard: http://%s:%d/\n", cfg.HTTPServer.Host, cfg.HTTPServer.Port)
		}

		var csvReporter *report.CSVReporter
		if cfg.Output.CSVFile != "" {
			var err error
			csvReporter, err = report.NewCSVReporter(cfg.Output.CSVFile)
			if err != nil {
				return fmt.Errorf("failed to create CSV reporter: %w", err)
			}
			defer csvReporter.Close()
		}

		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

		fmt.Printf("\nWarmup period: %s\n", cfg.Testing.WarmupPeriod)
		time.Sleep(cfg.Testing.WarmupPeriod)

		fmt.Println("\nStarting load test...")
		statistics.Start()
		clientMgr.StartPublishing()

		ticker := time.NewTicker(cfg.Output.Interval)
		defer ticker.Stop()

		testTimer := time.NewTimer(cfg.Testing.Duration)
		defer testTimer.Stop()

		fmt.Println("\n=== Load Test Running ===")
		printStatsHeader()

		running := true
		for running {
			select {
			case <-ticker.C:
				windowSummary := statistics.GetWindowSummary()
				printWindowStats(windowSummary)
				if csvReporter != nil {
					csvReporter.WriteWindowRecord(windowSummary)
				}

				if timeSeries != nil {
					timeSeries.Add(timeseries.DataPoint{
						Timestamp:    time.Now(),
						AvgLatencyMs: float64(windowSummary.AvgLatency) / float64(time.Millisecond),
						MinLatencyMs: float64(windowSummary.MinLatency) / float64(time.Millisecond),
						MaxLatencyMs: float64(windowSummary.MaxLatency) / float64(time.Millisecond),
						Throughput:   windowSummary.Throughput,
						Published:    windowSummary.Published,
						Received:     windowSummary.Received,
					})
				}

			case <-testTimer.C:
				fmt.Println("\nTest duration completed")
				running = false

			case sig := <-sigChan:
				fmt.Printf("\nReceived signal: %s, stopping...\n", sig)
				running = false
			}
		}

		clientMgr.StopPublishing()
		statistics.Stop()

		finalSummary := statistics.GetSummary()
		printFinalSummary(finalSummary)

		failureSummary := failureStats.GetSummary()
		if failureSummary.TotalFailures > 0 {
			printFailureSummary(failureSummary)
		}

		if csvReporter != nil {
			csvReporter.WriteSummary(finalSummary)
			fmt.Printf("\nCSV report saved to: %s\n", cfg.Output.CSVFile)
		}

		return nil
	},
}

func printConfig(cfg *config.Config) {
	fmt.Println("=== Configuration ===")
	fmt.Printf("Broker: %s\n", cfg.BrokerURL())
	fmt.Printf("Clients: %d\n", cfg.Clients.Count)
	if cfg.Topics.UseShareSub {
		fmt.Printf("Topic: %s (shared subscription, group: %s)\n", cfg.Topics.BaseTopic, cfg.Topics.ShareGroup)
	} else {
		fmt.Printf("Topic: %s (normal subscription)\n", cfg.Topics.BaseTopic)
	}
	fmt.Printf("QoS: %d\n", cfg.Topics.QoS)
	fmt.Printf("Message size: %d bytes\n", cfg.Testing.MessageSize)
	fmt.Printf("Publish rate: %d msg/s\n", cfg.Testing.PublishRate)
	fmt.Printf("Duration: %s\n", cfg.Testing.Duration)
	if cfg.Broker.TLS.Enabled {
		fmt.Println("TLS: Enabled")
	} else {
		fmt.Println("TLS: Disabled")
	}
	if cfg.Broker.Username != "" {
		fmt.Printf("Authentication: Enabled (user: %s)\n", cfg.Broker.Username)
	} else {
		fmt.Println("Authentication: Disabled")
	}
	if cfg.HTTPServer.Enabled {
		fmt.Printf("HTTP Server: http://%s:%d\n", cfg.HTTPServer.Host, cfg.HTTPServer.Port)
	}
	fmt.Printf("Max Concurrent Connects: %d\n", cfg.Clients.MaxConcurrentConnects)
	fmt.Printf("Connect Delay: %v\n", cfg.Clients.ConnectDelay)
}

func printStatsHeader() {
	fmt.Printf("%-10s %-10s %-10s %-10s %-10s %-15s %-15s\n",
		"Published", "Received", "Lost", "OutOrder", "Rate(msg/s)", "AvgLat(ms)", "MaxLat(ms)")
	fmt.Println("--------------------------------------------------------------------------------")
}

func printWindowStats(s *stats.WindowSummary) {
	fmt.Printf("%-10d %-10d %-10d %-10d %-10.2f %-15.2f %-15.2f\n",
		s.Published,
		s.Received,
		s.Lost,
		s.OutOfOrder,
		s.ReceiveRate,
		float64(s.AvgLatency)/float64(time.Millisecond),
		float64(s.MaxLatency)/float64(time.Millisecond),
	)
}

func printFinalSummary(s *stats.StatsSummary) {
	fmt.Println("\n=== Test Summary ===")
	fmt.Printf("Test Duration: %s\n", s.TestDuration.Round(time.Second))
	fmt.Printf("Total Published: %d\n", s.TotalPublished)
	fmt.Printf("Total Received: %d\n", s.TotalReceived)
	fmt.Printf("Total Lost: %d\n", s.TotalLost)
	fmt.Printf("Total Out of Order: %d\n", s.TotalOutOfOrder)
	fmt.Printf("Average Publish Rate: %.2f msg/s\n", s.Throughput)
	fmt.Printf("Average Receive Rate: %.2f msg/s\n", s.ReceiveRate)
	fmt.Printf("Message Loss Rate: %.4f%%\n", s.LossRate*100)
	fmt.Printf("Out of Order Rate: %.4f%%\n", s.OutOfOrderRate*100)
	fmt.Println("\nLatency Statistics:")
	fmt.Printf("  Average: %.2f ms\n", float64(s.AvgLatency)/float64(time.Millisecond))
	fmt.Printf("  Minimum: %.2f ms\n", float64(s.MinLatency)/float64(time.Millisecond))
	fmt.Printf("  Maximum: %.2f ms\n", float64(s.MaxLatency)/float64(time.Millisecond))
	fmt.Printf("  P50: %.2f ms\n", float64(s.P50Latency)/float64(time.Millisecond))
	fmt.Printf("  P95: %.2f ms\n", float64(s.P95Latency)/float64(time.Millisecond))
	fmt.Printf("  P99: %.2f ms\n", float64(s.P99Latency)/float64(time.Millisecond))
}

func printFailureSummary(s *stats.FailureSummary) {
	fmt.Println("\n=== Failure Injection Summary ===")
	fmt.Printf("Total Failures: %d\n", s.TotalFailures)
	fmt.Printf("Total Downtime: %s\n", s.TotalDowntime.Round(time.Millisecond))
	fmt.Printf("Average Downtime: %s\n", s.AvgDowntime.Round(time.Millisecond))
	fmt.Printf("Total Reconnect Attempts: %d\n", s.TotalReconnects)
	fmt.Printf("Successful Reconnects: %d\n", s.SuccessfulReconnects)
	fmt.Printf("Failed Reconnects: %d\n", s.FailedReconnects)
	fmt.Printf("Reconnect Success Rate: %.2f%%\n", s.ReconnectSuccessRate*100)
	fmt.Printf("Duplicate Messages: %d\n", s.DuplicateMessages)
	fmt.Printf("Unconfirmed Messages: %d\n", s.UnconfirmedMessages)

	if s.LastFailure != nil {
		fmt.Println("\nLast Failure Details:")
		fmt.Printf("  Failure Time: %s\n", s.LastFailure.FailureTime.Format(time.RFC3339))
		fmt.Printf("  Recovery Time: %s\n", s.LastFailure.RecoveryTime.Format(time.RFC3339))
		fmt.Printf("  Duration: %s\n", s.LastFailure.Duration.Round(time.Millisecond))
		fmt.Printf("  Reconnect Time: %s\n", s.LastFailure.ReconnectTime.Round(time.Millisecond))
		fmt.Printf("  Messages Lost: %d\n", s.LastFailure.MessagesLost)
		fmt.Printf("  Duplicate Messages: %d\n", s.LastFailure.MessagesDup)
		fmt.Printf("  Unconfirmed Messages: %d\n", s.LastFailure.Unconfirmed)
	}
}

func init() {
	rootCmd.AddCommand(runCmd)
}
