package main

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/robfig/cron/v3"
)

func main() {
	if err := InitDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}

	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	r.GET("/fetch", handleFetch)
	r.GET("/api/v1/summary", handleSummary)
	r.GET("/api/v1/export", handleExport)

	c := cron.New()
	c.AddFunc("@hourly", func() {
		log.Println("Running scheduled data fetch...")
		fetchAndStoreData()
	})
	c.Start()
	defer c.Stop()

	log.Println("Server starting on :8080")
	log.Fatal(r.Run(":8080"))
}

func handleFetch(c *gin.Context) {
	if err := fetchAndStoreData(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Data fetched and stored successfully"})
}

func handleSummary(c *gin.Context) {
	avgSteps, err := GetAverageStepsLast7Days()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	maxHeartRate, err := GetMaxHeartRateLast7Days()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"average_steps_last_7_days": avgSteps,
		"max_heart_rate_last_7_days": maxHeartRate,
		"generated_at":               time.Now().Format(time.RFC3339),
	})
}

func handleExport(c *gin.Context) {
	steps, err := GetAllSteps()
	if err != nil {
		log.Printf("Failed to get steps: %v", err)
		steps = []StepRecord{}
	}

	heartRates, err := GetAllHeartRates()
	if err != nil {
		log.Printf("Failed to get heart rates: %v", err)
		heartRates = []HeartRateRecord{}
	}

	var buf bytes.Buffer
	zipWriter := zip.NewWriter(&buf)

	stepsWriter, err := zipWriter.Create("steps.csv")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create steps.csv"})
		return
	}
	stepsCSV := csv.NewWriter(stepsWriter)
	stepsCSV.Write([]string{"date", "steps"})
	for _, step := range steps {
		stepsCSV.Write([]string{step.Date.Format("2006-01-02"), strconv.Itoa(step.Steps)})
	}
	stepsCSV.Flush()

	hrWriter, err := zipWriter.Create("heart_rate.csv")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create heart_rate.csv"})
		return
	}
	hrCSV := csv.NewWriter(hrWriter)
	hrCSV.Write([]string{"date", "heart_rate"})
	for _, hr := range heartRates {
		hrCSV.Write([]string{hr.Date.Format("2006-01-02"), strconv.Itoa(hr.HeartRate)})
	}
	hrCSV.Flush()

	if err := zipWriter.Close(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to close zip"})
		return
	}

	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", "attachment; filename=health_data_export.zip")
	c.Data(http.StatusOK, "application/zip", buf.Bytes())
}
