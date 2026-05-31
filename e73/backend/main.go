package main

import (
	"flag"
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
	var cliMode bool
	var compareMode bool
	var inputFile string
	var oldFile string
	var newFile string

	flag.BoolVar(&cliMode, "cli", false, "Run in CLI mode")
	flag.BoolVar(&compareMode, "compare", false, "Run comparison mode (CLI only)")
	flag.StringVar(&inputFile, "file", "", "Input CSV file path (required for single file CLI mode)")
	flag.StringVar(&oldFile, "old", "", "Old CSV file path (required for comparison mode)")
	flag.StringVar(&newFile, "new", "", "New CSV file path (required for comparison mode)")
	flag.Parse()

	if cliMode {
		if compareMode {
			if oldFile == "" || newFile == "" {
				log.Fatal("Error: -old and -new flags are required for comparison mode")
			}
			RunCLICompare(oldFile, newFile)
		} else {
			if inputFile == "" {
				log.Fatal("Error: -file flag is required for CLI mode")
			}
			RunCLI(inputFile)
		}
	} else {
		RunServer()
	}
}

func RunServer() {
	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	r.POST("/api/analyze", AnalyzeHandler)
	r.POST("/api/compare", ComparisonHandler)

	r.Run(":8080")
}

func RunCLI(filePath string) {
	data, skippedCount, err := ParseCSV(filePath)
	if err != nil {
		log.Fatalf("Error parsing CSV: %v", err)
	}

	if skippedCount > 0 {
		log.Printf("Warning: skipped %d malformed records", skippedCount)
	}

	results := AnalyzeData(data, skippedCount)
	PrintResultsJSON(results)
}

func RunCLICompare(oldPath, newPath string) {
	oldData, oldSkipped, err := ParseCSV(oldPath)
	if err != nil {
		log.Fatalf("Error parsing old CSV: %v", err)
	}

	newData, newSkipped, err := ParseCSV(newPath)
	if err != nil {
		log.Fatalf("Error parsing new CSV: %v", err)
	}

	if oldSkipped > 0 {
		log.Printf("Warning: skipped %d malformed records in old file", oldSkipped)
	}
	if newSkipped > 0 {
		log.Printf("Warning: skipped %d malformed records in new file", newSkipped)
	}

	resultOld := AnalyzeData(oldData, oldSkipped)
	resultNew := AnalyzeData(newData, newSkipped)

	comparisonResult := CompareResults(resultOld, resultNew)
	PrintComparisonJSON(comparisonResult)
}