package main

import (
	"encoding/csv"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

func AnalyzeHandler(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to get file"})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open file"})
		return
	}
	defer src.Close()

	reader := csv.NewReader(src)
	records, err := reader.ReadAll()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse CSV"})
		return
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
			skippedCount++
			continue
		}

		reqTime, err := parseTime(record[0])
		if err != nil {
			skippedCount++
			continue
		}

		respTime, err := parseTime(record[1])
		if err != nil {
			skippedCount++
			continue
		}

		statusCode, err := strconv.Atoi(record[3])
		if err != nil {
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

	if len(entries) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid data found in CSV"})
		return
	}

	results := analyzeEntries(entries, skippedCount)
	c.JSON(http.StatusOK, results)
}

func analyzeEntries(entries []LogEntry, skippedCount int) AnalysisResult {
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

func HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func ComparisonHandler(c *gin.Context) {
	fileOld, err := c.FormFile("file_old")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to get old file"})
		return
	}

	fileNew, err := c.FormFile("file_new")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to get new file"})
		return
	}

	resultOld, err := analyzeFile(fileOld)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to analyze old file: " + err.Error()})
		return
	}

	resultNew, err := analyzeFile(fileNew)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to analyze new file: " + err.Error()})
		return
	}

	comparisonResult := CompareResults(resultOld, resultNew)
	c.JSON(http.StatusOK, comparisonResult)
}

func analyzeFile(fileHeader *multipart.FileHeader) (AnalysisResult, error) {
	src, err := fileHeader.Open()
	if err != nil {
		return AnalysisResult{}, err
	}
	defer src.Close()

	reader := csv.NewReader(src)
	records, err := reader.ReadAll()
	if err != nil {
		return AnalysisResult{}, err
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
			skippedCount++
			continue
		}

		reqTime, err := parseTime(record[0])
		if err != nil {
			skippedCount++
			continue
		}

		respTime, err := parseTime(record[1])
		if err != nil {
			skippedCount++
			continue
		}

		statusCode, err := strconv.Atoi(record[3])
		if err != nil {
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

	if len(entries) == 0 {
		return AnalysisResult{}, fmt.Errorf("no valid data found in CSV")
	}

	return analyzeEntries(entries, skippedCount), nil
}

func StreamHandler(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to get file"})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open file"})
		return
	}
	defer src.Close()

	reader := csv.NewReader(src)

	pathMap := make(map[string][]float64)
	pathErrors := make(map[string]int)
	var allLatencies []float64
	totalErrors := 0
	totalCount := 0
	skippedCount := 0

	c.Stream(func(w io.Writer) bool {
		for {
			record, err := reader.Read()
			if err == io.EOF {
				break
			}
			if err != nil {
				return false
			}

			if len(record) < 4 {
				skippedCount++
				continue
			}

			reqTime, err := parseTime(record[0])
			if err != nil {
				skippedCount++
				continue
			}

			respTime, err := parseTime(record[1])
			if err != nil {
				skippedCount++
				continue
			}

			statusCode, err := strconv.Atoi(record[3])
			if err != nil {
				skippedCount++
				continue
			}

			latency := respTime.Sub(reqTime).Seconds() * 1000

			pathMap[record[2]] = append(pathMap[record[2]], latency)
			allLatencies = append(allLatencies, latency)
			totalCount++

			if statusCode >= 400 {
				pathErrors[record[2]]++
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

		result := AnalysisResult{
			APIResults:       apiResults,
			Histogram:        histogram,
			TotalRequests:    totalCount,
			TotalErrors:      totalErrors,
			OverallErrorRate: float64(totalErrors) / float64(totalCount) * 100,
			SkippedCount:     skippedCount,
		}

		c.JSON(http.StatusOK, result)
		return true
	})
}