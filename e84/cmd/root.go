package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "mqtt-load-tester",
	Short: "MQTT load testing tool with shared subscription support",
	Long:  `A command-line tool for load testing MQTT brokers with support for multiple clients, shared subscriptions, TLS authentication, and real-time statistics.`,
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().StringP("config", "c", "config.yaml", "Path to configuration file")
}
