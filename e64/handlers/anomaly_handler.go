package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"anomaly-detection-api/repository"
)

type AnomalyHandler struct{}

func NewAnomalyHandler() *AnomalyHandler {
	return &AnomalyHandler{}
}

func (h *AnomalyHandler) GetEvents(c *gin.Context) {
	tenantID := c.GetString("tenant_id")

	startTimeStr := c.Query("start_time")
	endTimeStr := c.Query("end_time")
	anomalyType := c.Query("anomaly_type")

	var startTime, endTime time.Time
	var err error

	if startTimeStr == "" {
		startTime = time.Now().AddDate(0, 0, -7)
	} else {
		startTime, err = time.Parse(time.RFC3339, startTimeStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid start_time format"})
			return
		}
	}

	if endTimeStr == "" {
		endTime = time.Now()
	} else {
		endTime, err = time.Parse(time.RFC3339, endTimeStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid end_time format"})
			return
		}
	}

	events, err := repository.GetAnomalyEvents(c.Request.Context(), tenantID, startTime, endTime, anomalyType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch events"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"events": events,
		"count":  len(events),
	})
}
