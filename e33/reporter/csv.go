package reporter

import (
	"encoding/csv"
	"fmt"
	"os"
	"time"

	"quic-load-tester/stats"
)

func GenerateCSVReport(filename string, metrics *stats.Metrics) error {
	file, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	connPerc := metrics.GetConnectionTimePercentiles()
	rttPerc := metrics.GetRTTPercentiles()
	avgConnTime, avgRTT := metrics.GetAverages()
	totalReq, failedReq, retrans, lost := metrics.GetCounts()
	connCount := metrics.GetConnectionCount()
	sessionReused, sessionNew, sessionTotal := metrics.GetSessionStats()
	sessionReuseRate := metrics.GetSessionReuseRate()

	headers := []string{
		"Metric",
		"Value",
		"Unit",
	}
	if err := writer.Write(headers); err != nil {
		return err
	}

	writeRow := func(metric, value, unit string) error {
		return writer.Write([]string{metric, value, unit})
	}

	writeRow("Test Time", time.Now().Format(time.RFC3339), "")

	writeRow("Total Connections", fmt.Sprintf("%d", connCount), "count")
	writeRow("Average Connection Time", fmt.Sprintf("%.2f", avgConnTime.Seconds()*1000), "ms")
	writeRow("Connection Time P50", fmt.Sprintf("%.2f", connPerc.P50.Seconds()*1000), "ms")
	writeRow("Connection Time P95", fmt.Sprintf("%.2f", connPerc.P95.Seconds()*1000), "ms")
	writeRow("Connection Time P99", fmt.Sprintf("%.2f", connPerc.P99.Seconds()*1000), "ms")

	writeRow("Total Requests", fmt.Sprintf("%d", totalReq), "count")
	writeRow("Failed Requests", fmt.Sprintf("%d", failedReq), "count")
	if totalReq > 0 {
		writeRow("Success Rate", fmt.Sprintf("%.2f", float64(totalReq-failedReq)/float64(totalReq)*100), "%")
	}
	writeRow("Average RTT", fmt.Sprintf("%.2f", avgRTT.Seconds()*1000), "ms")
	writeRow("RTT P50", fmt.Sprintf("%.2f", rttPerc.P50.Seconds()*1000), "ms")
	writeRow("RTT P95", fmt.Sprintf("%.2f", rttPerc.P95.Seconds()*1000), "ms")
	writeRow("RTT P99", fmt.Sprintf("%.2f", rttPerc.P99.Seconds()*1000), "ms")

	writeRow("Total Retransmissions", fmt.Sprintf("%d", retrans), "count")
	writeRow("Total Packets Lost", fmt.Sprintf("%d", lost), "count")
	if totalReq > 0 {
		writeRow("Retransmission Rate", fmt.Sprintf("%.4f", float64(retrans)/float64(totalReq)), "ratio")
	}

	writeRow("TLS Session Total", fmt.Sprintf("%d", sessionTotal), "count")
	writeRow("TLS Session Reused", fmt.Sprintf("%d", sessionReused), "count")
	writeRow("TLS Session New", fmt.Sprintf("%d", sessionNew), "count")
	writeRow("TLS Session Reuse Rate", fmt.Sprintf("%.2f", sessionReuseRate), "%")

	return nil
}
