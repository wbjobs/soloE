package handlers

import (
	"arbiter-log-analyzer/models"
	"arbiter-log-analyzer/utils"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func SimulateLogs(c *gin.Context) {
	nodeCount, _ := strconv.Atoi(c.DefaultQuery("node_count", "3"))
	termCount, _ := strconv.Atoi(c.DefaultQuery("term_count", "10"))
	brainSplitRate, _ := strconv.ParseFloat(c.DefaultQuery("brain_split_rate", "0.2"), 64)
	offlineNode := c.DefaultQuery("offline_node", "")
	offlineDuration, _ := strconv.Atoi(c.DefaultQuery("offline_duration", "3"))
	offlineStartTerm, _ := strconv.Atoi(c.DefaultQuery("offline_start_term", "0"))

	if nodeCount < 1 {
		nodeCount = 3
	}
	if termCount < 1 {
		termCount = 10
	}
	if brainSplitRate < 0 || brainSplitRate > 1 {
		brainSplitRate = 0.2
	}
	if offlineDuration < 1 {
		offlineDuration = 3
	}

	logs := utils.GenerateSimulatedLogs(nodeCount, termCount, brainSplitRate, offlineNode, offlineDuration, offlineStartTerm)

	c.Header("Content-Type", "application/x-ndjson")
	c.Header("Content-Disposition", "attachment; filename=arbiter_logs.jsonl")

	for _, log := range logs {
		c.JSON(http.StatusOK, log)
		c.Writer.Write([]byte("\n"))
	}
}
