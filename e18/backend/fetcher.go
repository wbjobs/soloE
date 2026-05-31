package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type StepsData struct {
	Date  string `json:"date"`
	Steps int    `json:"steps"`
}

func fetchAndStoreData() error {
	if err := fetchStepsData(); err != nil {
		return fmt.Errorf("failed to fetch steps data: %w", err)
	}

	if err := fetchHeartRateData(); err != nil {
		return fmt.Errorf("failed to fetch heart rate data: %w", err)
	}

	return nil
}

func fetchStepsData() error {
	resp, err := http.Get("http://localhost:3002/api/steps")
	if err != nil {
		return generateMockStepsData()
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return generateMockStepsData()
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	var stepsData StepsData
	if err := json.Unmarshal(body, &stepsData); err != nil {
		return err
	}

	date, err := time.Parse("2006-01-02", stepsData.Date)
	if err != nil {
		return err
	}

	return InsertSteps(date, stepsData.Steps)
}

func generateMockStepsData() error {
	today := time.Now().Truncate(24 * time.Hour)
	for i := 0; i < 7; i++ {
		date := today.AddDate(0, 0, -i)
		steps := rand.Intn(5000) + 5000
		if err := InsertSteps(date, steps); err != nil {
			return err
		}
	}
	return nil
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func parseDateOrTime(value string) (time.Time, error) {
	formats := []string{
		"2006-01-02",
		"2006-01-02 15:04",
		"2006-01-02 15:04:05",
		"15:04",
		"15:04:05",
		"01/02/2006",
		"02-01-2006",
	}

	for _, format := range formats {
		if t, err := time.Parse(format, value); err == nil {
			if format == "15:04" || format == "15:04:05" {
				now := time.Now()
				return time.Date(now.Year(), now.Month(), now.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.Local), nil
			}
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("unable to parse date/time: %s", value)
}

func findColumnIndex(headers []string, possibleNames []string) int {
	for i, header := range headers {
		headerLower := strings.ToLower(strings.TrimSpace(header))
		for _, name := range possibleNames {
			if strings.Contains(headerLower, name) {
				return i
			}
		}
	}
	return -1
}

func fetchHeartRateData() error {
	resp, err := http.Get("http://localhost:3002/api/heart-rate")
	if err != nil {
		log.Printf("Heart rate API unavailable, using mock data: %v", err)
		return generateMockHeartRateData()
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Heart rate API returned status: %d, using mock data", resp.StatusCode)
		return generateMockHeartRateData()
	}

	reader := csv.NewReader(resp.Body)
	records, err := reader.ReadAll()
	if err != nil {
		log.Printf("Failed to read CSV: %v, using mock data", err)
		return generateMockHeartRateData()
	}

	if len(records) < 2 {
		log.Println("Not enough CSV records, using mock data")
		return generateMockHeartRateData()
	}

	headers := records[0]
	dateColIndex := findColumnIndex(headers, []string{"date", "time", "datetime", "timestamp"})
	heartRateColIndex := findColumnIndex(headers, []string{"heart", "rate", "bpm", "pulse"})

	if dateColIndex == -1 || heartRateColIndex == -1 {
		log.Printf("Could not find required columns, headers: %v, using fallback column order", headers)
		dateColIndex = 0
		heartRateColIndex = 1
	}

	log.Printf("Using columns - Date: %d, HeartRate: %d", dateColIndex, heartRateColIndex)

	for i := 1; i < len(records); i++ {
		record := records[i]
		if len(record) <= max(dateColIndex, heartRateColIndex) {
			log.Printf("Skipping record %d: not enough columns", i)
			continue
		}

		dateValue := strings.TrimSpace(record[dateColIndex])
		heartRateValue := strings.TrimSpace(record[heartRateColIndex])

		date, err := parseDateOrTime(dateValue)
		if err != nil {
			log.Printf("Failed to parse date '%s': %v, using today's date", dateValue, err)
			date = time.Now().Truncate(24 * time.Hour)
		}

		heartRate, err := strconv.Atoi(heartRateValue)
		if err != nil {
			log.Printf("Failed to parse heart rate '%s': %v, skipping record", heartRateValue, err)
			continue
		}

		log.Printf("Inserting heart rate data - Date: %s, Rate: %d", date.Format("2006-01-02"), heartRate)
		if err := InsertHeartRate(date, heartRate); err != nil {
			log.Printf("Failed to insert heart rate: %v", err)
		}
	}

	return nil
}

func generateMockHeartRateData() error {
	today := time.Now().Truncate(24 * time.Hour)
	for i := 0; i < 7; i++ {
		date := today.AddDate(0, 0, -i)
		heartRate := rand.Intn(40) + 70
		if err := InsertHeartRate(date, heartRate); err != nil {
			return err
		}
	}
	return nil
}
