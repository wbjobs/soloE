package handlers

import (
	"arbiter-log-analyzer/models"
	"arbiter-log-analyzer/utils"
	"bufio"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

func AnalyzeLogs(c *gin.Context) {
	var logs []models.VoteLog

	contentType := c.ContentType()

	if contentType == "multipart/form-data" {
		file, _, err := c.Request.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to get file: " + err.Error()})
			return
		}
		defer file.Close()

		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := scanner.Bytes()
			if len(line) == 0 {
				continue
			}
			var log models.VoteLog
			if err := json.Unmarshal(line, &log); err != nil {
				continue
			}
			logs = append(logs, log)
		}

		if err := scanner.Err(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read file: " + err.Error()})
			return
		}
	} else {
		if err := c.ShouldBindJSON(&logs); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body: " + err.Error()})
			return
		}
	}

	if len(logs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No logs provided"})
		return
	}

	result := utils.AnalyzeLogs(logs)

	c.JSON(http.StatusOK, result)
}
