package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sort"
	"strconv"
	"time"
)

type LogEntry struct {
	RequestTime  time.Time
	ResponseTime time.Time
	APIPath      string
	StatusCode   int
	Latency      float64
}

type APIResult struct {
	APIPath      string  `json:"api_path"`
	TotalCount   int     `json:"total_count"`
	ErrorCount   int     `json:"error_count"`
	ErrorRate    float64 `json:"error_rate"`
	P95Latency   float64 `json:"p95_latency"`
	P99Latency   float64 `json:"p99_latency"`
	MinLatency   float64 `json:"min_latency"`
	MaxLatency   float64 `json:"max_latency"`
	AvgLatency   float64 `json:"avg_latency"`
}

type HistogramBin struct {
	Range string  `json:"range"`
	Count int     `json:"count"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

type AnalysisResult struct {
	APIResults       []APIResult   `json:"api_results"`
	Histogram        []HistogramBin `json:"histogram"`
	TotalRequests    int          `json:"total_requests"`
	TotalErrors      int          `json:"total_errors"`
	OverallErrorRate float64      `json:"overall_error_rate"`
	SkippedCount     int          `json:"skipped_count"`
}

func parseTime(timeStr string) (time.Time, error) {
	formats := []string{
		time.RFC3339,
		"2006-01-02 15:04:05.000000",
		"2006-01-02 15:04:05",
		"2006/01/02 15:04:05",
		"02-Jan-2006 15:04:05",
	}

	for _, format := range formats {
		if t, err := time.Parse(format, timeStr); err == nil {
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("unable to parse time: %s", timeStr)
}

func ParseCSV(filePath string) ([]LogEntry, int, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, 0, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		return nil, 0, err
	}

	var entries []LogEntry
	skippedCount := 0
	headerSkipped := false

	for lineNum, record := range records {
		if !headerSkipped {
			headerSkipped = true
			continue
		}

		if len(record) < 4 {
			log.Printf("Skipping line %d: insufficient fields", lineNum+1)
			skippedCount++
			continue
		}

		reqTime, err := parseTime(record[0])
		if err != nil {
			log.Printf("Skipping line %d: failed to parse request time: %v", lineNum+1, err)
			skippedCount++
			continue
		}

		respTime, err := parseTime(record[1])
		if err != nil {
			log.Printf("Skipping line %d: failed to parse response time: %v", lineNum+1, err)
			skippedCount++
			continue
		}

		statusCode, err := strconv.Atoi(record[3])
		if err != nil {
			log.Printf("Skipping line %d: failed to parse status code: %v", lineNum+1, err)
			skippedCount++
			continue
		}

		latency := respTime.Sub(reqTime).Seconds() * 1000

		entries = append(entries, LogEntry{
			RequestTime:  reqTime,
			ResponseTime: respTime,
			APIPath:      record[2],
			StatusCode:   statusCode,
			Latency:      latency,
		})
	}

	return entries, skippedCount, nil
}

func AnalyzeData(entries []LogEntry, skippedCount int) AnalysisResult {
	pathMap := make(map[string][]float64)
	pathErrors := make(map[string]int)
	var allLatencies []float64
	totalErrors := 0

	for _, entry := range entries {
		pathMap[entry.APIPath] = append(pathMap[entry.APIPath], entry.Latency)
		allLatencies = append(allLatencies, entry.Latency)

		if entry.StatusCode >= 400 {
			pathErrors[entry.APIPath]++
			totalErrors++
		}
	}

	var apiResults []APIResult
	for path, latencies := range pathMap {
		sort.Float64s(latencies)
		total := len(latencies)
		errors := pathErrors[path]

		p95 := percentile(latencies, 95)
		p99 := percentile(latencies, 99)
		min := latencies[0]
		max := latencies[len(latencies)-1]
		avg := average(latencies)

		apiResults = append(apiResults, APIResult{
			APIPath:    path,
			TotalCount: total,
			ErrorCount: errors,
			ErrorRate:  float64(errors) / float64(total) * 100,
			P95Latency: p95,
			P99Latency: p99,
			MinLatency: min,
			MaxLatency: max,
			AvgLatency: avg,
		})
	}

	sort.Slice(apiResults, func(i, j int) bool {
		return apiResults[i].APIPath < apiResults[j].APIPath
	})

	histogram := buildHistogram(allLatencies)

	return AnalysisResult{
		APIResults:       apiResults,
		Histogram:        histogram,
		TotalRequests:    len(entries),
		TotalErrors:      totalErrors,
		OverallErrorRate: float64(totalErrors) / float64(len(entries)) * 100,
		SkippedCount:     skippedCount,
	}
}

func percentile(data []float64, p float64) float64 {
	n := len(data)
	if n == 0 {
		return 0
	}
	index := int((p / 100.0) * float64(n-1))
	if index >= n {
		index = n - 1
	}
	return data[index]
}

func average(data []float64) float64 {
	if len(data) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range data {
		sum += v
	}
	return sum / float64(len(data))
}

func buildHistogram(latencies []float64) []HistogramBin {
	if len(latencies) == 0 {
		return nil
	}

	sort.Float64s(latencies)
	maxLatency := latencies[len(latencies)-1]

	bins := []float64{0, 10, 50, 100, 200, 500, 1000, 2000, 5000}
	if maxLatency > 5000 {
		bins = append(bins, maxLatency+1)
	}

	var histogram []HistogramBin
	for i := 0; i < len(bins)-1; i++ {
		start := bins[i]
		end := bins[i+1]
		count := 0

		for _, latency := range latencies {
			if latency >= start && latency < end {
				count++
			}
		}

		rangeLabel := fmt.Sprintf("%.0f-%.0fms", start, end)
		if i == len(bins)-2 {
			rangeLabel = fmt.Sprintf(">=%.0fms", start)
		}

		if count > 0 || i < len(bins)-2 {
			histogram = append(histogram, HistogramBin{
				Range: rangeLabel,
				Count: count,
				Start: start,
				End:   end,
			})
		}
	}

	return histogram
}

type ComparisonAPIResult struct {
	APIPath          string  `json:"api_path"`
	TotalCountOld    int     `json:"total_count_old"`
	TotalCountNew    int     `json:"total_count_new"`
	ErrorRateOld     float64 `json:"error_rate_old"`
	ErrorRateNew     float64 `json:"error_rate_new"`
	P95LatencyOld    float64 `json:"p95_latency_old"`
	P95LatencyNew    float64 `json:"p95_latency_new"`
	P95ChangeRate    float64 `json:"p95_change_rate"`
	P99LatencyOld    float64 `json:"p99_latency_old"`
	P99LatencyNew    float64 `json:"p99_latency_new"`
	P99ChangeRate    float64 `json:"p99_change_rate"`
	AvgLatencyOld    float64 `json:"avg_latency_old"`
	AvgLatencyNew    float64 `json:"avg_latency_new"`
	AvgChangeRate    float64 `json:"avg_change_rate"`
	ErrorRateChange  float64 `json:"error_rate_change"`
}

type ComparisonResult struct {
	ComparisonResults []ComparisonAPIResult `json:"comparison_results"`
	TotalRequestsOld  int                   `json:"total_requests_old"`
	TotalRequestsNew  int                   `json:"total_requests_new"`
	TotalErrorsOld    int                   `json:"total_errors_old"`
	TotalErrorsNew    int                   `json:"total_errors_new"`
	OverallErrorRateOld  float64            `json:"overall_error_rate_old"`
	OverallErrorRateNew  float64            `json:"overall_error_rate_new"`
	OverallErrorRateChange float64           `json:"overall_error_rate_change"`
	OverallP95ChangeRate  float64           `json:"overall_p95_change_rate"`
	SkippedCountOld   int                   `json:"skipped_count_old"`
	SkippedCountNew   int                   `json:"skipped_count_new"`
}

func CompareResults(resultOld, resultNew AnalysisResult) ComparisonResult {
	oldMap := make(map[string]APIResult)
	for _, r := range resultOld.APIResults {
		oldMap[r.APIPath] = r
	}

	newMap := make(map[string]APIResult)
	for _, r := range resultNew.APIResults {
		newMap[r.APIPath] = r
	}

	allPaths := make(map[string]bool)
	for path := range oldMap {
		allPaths[path] = true
	}
	for path := range newMap {
		allPaths[path] = true
	}

	var comparisonResults []ComparisonAPIResult
	var totalP95Old, totalP95New float64
	var pathCount int

	for path := range allPaths {
		oldResult := oldMap[path]
		newResult := newMap[path]

		p95ChangeRate := calculateChangeRate(oldResult.P95Latency, newResult.P95Latency)
		p99ChangeRate := calculateChangeRate(oldResult.P99Latency, newResult.P99Latency)
		avgChangeRate := calculateChangeRate(oldResult.AvgLatency, newResult.AvgLatency)
		errorRateChange := newResult.ErrorRate - oldResult.ErrorRate

		if oldResult.TotalCount > 0 && newResult.TotalCount > 0 {
			totalP95Old += oldResult.P95Latency
			totalP95New += newResult.P95Latency
			pathCount++
		}

		comparisonResults = append(comparisonResults, ComparisonAPIResult{
			APIPath:         path,
			TotalCountOld:   oldResult.TotalCount,
			TotalCountNew:   newResult.TotalCount,
			ErrorRateOld:    oldResult.ErrorRate,
			ErrorRateNew:    newResult.ErrorRate,
			P95LatencyOld:   oldResult.P95Latency,
			P95LatencyNew:   newResult.P95Latency,
			P95ChangeRate:   p95ChangeRate,
			P99LatencyOld:   oldResult.P99Latency,
			P99LatencyNew:   newResult.P99Latency,
			P99ChangeRate:   p99ChangeRate,
			AvgLatencyOld:   oldResult.AvgLatency,
			AvgLatencyNew:   newResult.AvgLatency,
			AvgChangeRate:   avgChangeRate,
			ErrorRateChange: errorRateChange,
		})
	}

	sort.Slice(comparisonResults, func(i, j int) bool {
		return comparisonResults[i].APIPath < comparisonResults[j].APIPath
	})

	overallErrorRateChange := resultNew.OverallErrorRate - resultOld.OverallErrorRate
	overallP95ChangeRate := 0.0
	if totalP95Old > 0 {
		overallP95ChangeRate = ((totalP95New / float64(pathCount)) - (totalP95Old / float64(pathCount))) / (totalP95Old / float64(pathCount)) * 100
	}

	return ComparisonResult{
		ComparisonResults:       comparisonResults,
		TotalRequestsOld:        resultOld.TotalRequests,
		TotalRequestsNew:        resultNew.TotalRequests,
		TotalErrorsOld:          resultOld.TotalErrors,
		TotalErrorsNew:          resultNew.TotalErrors,
		OverallErrorRateOld:     resultOld.OverallErrorRate,
		OverallErrorRateNew:     resultNew.OverallErrorRate,
		OverallErrorRateChange:  overallErrorRateChange,
		OverallP95ChangeRate:    overallP95ChangeRate,
		SkippedCountOld:         resultOld.SkippedCount,
		SkippedCountNew:         resultNew.SkippedCount,
	}
}

func calculateChangeRate(old, new float64) float64 {
	if old == 0 {
		return 0
	}
	return (new - old) / old * 100
}

func PrintResultsJSON(results AnalysisResult) {
	jsonData, err := json.MarshalIndent(results, "", "  ")
	if err != nil {
		log.Fatalf("Error marshaling results: %v", err)
	}
	fmt.Println(string(jsonData))
}

func PrintComparisonJSON(results ComparisonResult) {
	jsonData, err := json.MarshalIndent(results, "", "  ")
	if err != nil {
		log.Fatalf("Error marshaling comparison results: %v", err)
	}
	fmt.Println(string(jsonData))
}