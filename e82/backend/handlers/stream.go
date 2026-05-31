package handlers

import (
	"arbiter-log-analyzer/models"
	"arbiter-log-analyzer/utils"
	"encoding/json"
	"strconv"
	"time"

	"github.com/gin-contrib/sse"
	"github.com/gin-gonic/gin"
)

func StreamLogs(c *gin.Context) {
	nodeCount, _ := strconv.Atoi(c.DefaultQuery("node_count", "3"))
	interval, _ := strconv.Atoi(c.DefaultQuery("interval", "1000"))
	brainSplitRate, _ := strconv.ParseFloat(c.DefaultQuery("brain_split_rate", "0.2"), 64)
	offlineNode := c.DefaultQuery("offline_node", "")
	offlineDuration, _ := strconv.Atoi(c.DefaultQuery("offline_duration", "3"))
	offlineStartTerm, _ := strconv.Atoi(c.DefaultQuery("offline_start_term", "5"))

	if nodeCount < 1 {
		nodeCount = 3
	}
	if interval < 100 {
		interval = 1000
	}
	if offlineDuration < 1 {
		offlineDuration = 3
	}
	if offlineStartTerm <= 0 {
		offlineStartTerm = 5
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")

	term := 1
	ticker := time.NewTicker(time.Duration(interval) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			isOfflineTerm := offlineNode != "" && term >= offlineStartTerm && term < offlineStartTerm+offlineDuration

			effectiveRate := brainSplitRate
			if isOfflineTerm {
				effectiveRate = 0.8
			}

			logs := utils.GenerateSimulatedLogs(nodeCount, 1, effectiveRate, offlineNode, offlineDuration, offlineStartTerm)
			for i := range logs {
				logs[i].Term = int64(term)
				if isOfflineTerm {
					logs[i].AffectedBy = offlineNode
				}
			}

			term++

			analysis := utils.AnalyzeLogs(logs)

			data := map[string]interface{}{
				"logs":     logs,
				"analysis": analysis,
				"term":     term - 1,
			}

			jsonData, _ := json.Marshal(data)

			sse.Encode(c.Writer, sse.Event{
				Event: "log",
				Data:  string(jsonData),
			})

			c.Writer.Flush()

			if term > 100 {
				return
			}
		}
	}
}
