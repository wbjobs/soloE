package report

import (
	"encoding/csv"
	"fmt"
	"os"
	"time"

	"mqtt-load-tester/internal/stats"
)

type CSVReporter struct {
	file        *os.File
	writer      *csv.Writer
	headers     []string
}

func NewCSVReporter(filename string) (*CSVReporter, error) {
	file, err := os.Create(filename)
	if err != nil {
		return nil, fmt.Errorf("failed to create CSV file: %w", err)
	}

	writer := csv.NewWriter(file)

	headers := []string{
		"Timestamp",
		"Window_Duration_Seconds",
		"Published",
		"Received",
		"Lost",
		"Out_Of_Order",
		"Publish_Rate_Msg_Sec",
		"Receive_Rate_Msg_Sec",
		"Avg_Latency_Ms",
		"Min_Latency_Ms",
		"Max_Latency_Ms",
	}

	if err := writer.Write(headers); err != nil {
		file.Close()
		return nil, fmt.Errorf("failed to write CSV headers: %w", err)
	}
	writer.Flush()

	return &CSVReporter{
		file:    file,
		writer:  writer,
		headers: headers,
	}, nil
}

func (r *CSVReporter) WriteWindowRecord(summary *stats.WindowSummary) error {
	record := []string{
		time.Now().Format(time.RFC3339),
		fmt.Sprintf("%.2f", summary.WindowDuration.Seconds()),
		fmt.Sprintf("%d", summary.Published),
		fmt.Sprintf("%d", summary.Received),
		fmt.Sprintf("%d", summary.Lost),
		fmt.Sprintf("%d", summary.OutOfOrder),
		fmt.Sprintf("%.2f", summary.Throughput),
		fmt.Sprintf("%.2f", summary.ReceiveRate),
		fmt.Sprintf("%.2f", float64(summary.AvgLatency)/float64(time.Millisecond)),
		fmt.Sprintf("%.2f", float64(summary.MinLatency)/float64(time.Millisecond)),
		fmt.Sprintf("%.2f", float64(summary.MaxLatency)/float64(time.Millisecond)),
	}

	if err := r.writer.Write(record); err != nil {
		return fmt.Errorf("failed to write CSV record: %w", err)
	}
	r.writer.Flush()
	return nil
}

func (r *CSVReporter) WriteSummary(summary *stats.StatsSummary) error {
	summaryHeaders := []string{
		"",
		"Total_Published",
		"Total_Received",
		"Total_Lost",
		"Total_Out_Of_Order",
		"Loss_Rate_Percent",
		"Out_Of_Order_Rate_Percent",
		"Avg_Publish_Rate_Msg_Sec",
		"Avg_Receive_Rate_Msg_Sec",
		"Avg_Latency_Ms",
		"Min_Latency_Ms",
		"Max_Latency_Ms",
		"P50_Latency_Ms",
		"P95_Latency_Ms",
		"P99_Latency_Ms",
		"Test_Duration_Seconds",
	}

	record := []string{
		"SUMMARY",
		fmt.Sprintf("%d", summary.TotalPublished),
		fmt.Sprintf("%d", summary.TotalReceived),
		fmt.Sprintf("%d", summary.TotalLost),
		fmt.Sprintf("%d", summary.TotalOutOfOrder),
		fmt.Sprintf("%.4f", summary.LossRate*100),
		fmt.Sprintf("%.4f", summary.OutOfOrderRate*100),
		fmt.Sprintf("%.2f", summary.Throughput),
		fmt.Sprintf("%.2f", summary.ReceiveRate),
		fmt.Sprintf("%.2f", float64(summary.AvgLatency)/float64(time.Millisecond)),
		fmt.Sprintf("%.2f", float64(summary.MinLatency)/float64(time.Millisecond)),
		fmt.Sprintf("%.2f", float64(summary.MaxLatency)/float64(time.Millisecond)),
		fmt.Sprintf("%.2f", float64(summary.P50Latency)/float64(time.Millisecond)),
		fmt.Sprintf("%.2f", float64(summary.P95Latency)/float64(time.Millisecond)),
		fmt.Sprintf("%.2f", float64(summary.P99Latency)/float64(time.Millisecond)),
		fmt.Sprintf("%.2f", summary.TestDuration.Seconds()),
	}

	r.writer.Write([]string{})
	r.writer.Write(summaryHeaders)
	r.writer.Write(record)
	r.writer.Flush()
	return nil
}

func (r *CSVReporter) Close() error {
	r.writer.Flush()
	if err := r.writer.Error(); err != nil {
		return fmt.Errorf("CSV writer error: %w", err)
	}
	return r.file.Close()
}
