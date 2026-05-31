package handlers

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"anomaly-detection-api/models"
	"anomaly-detection-api/services"
)

type SensorHandler struct {
	batchProcessor *services.BatchProcessor
}

func NewSensorHandler(bp *services.BatchProcessor) *SensorHandler {
	return &SensorHandler{
		batchProcessor: bp,
	}
}

func (h *SensorHandler) SubmitData(c *gin.Context) {
	tenantID := c.GetString("tenant_id")

	var data models.SensorData
	if err := c.ShouldBindJSON(&data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	data.TenantID = tenantID
	if data.Timestamp.IsZero() {
		data.Timestamp = time.Now()
	}

	if err := h.batchProcessor.AddData(c.Request.Context(), &data); err != nil {
		log.Printf("Failed to add data to batch: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save data"})
		return
	}

	c.JSON(http.StatusAccepted, gin.H{
		"message": "Data accepted",
		"status":  "processing",
	})
}

func (h *SensorHandler) SubmitBatchData(c *gin.Context) {
	tenantID := c.GetString("tenant_id")

	var batch []models.SensorData
	if err := c.ShouldBindJSON(&batch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(batch) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Empty batch"})
		return
	}

	now := time.Now()
	count := 0

	for i := range batch {
		batch[i].TenantID = tenantID
		if batch[i].Timestamp.IsZero() {
			batch[i].Timestamp = now
		}

		if err := h.batchProcessor.AddData(c.Request.Context(), &batch[i]); err != nil {
			log.Printf("Failed to add data to batch: %v", err)
			continue
		}
		count++
	}

	c.JSON(http.StatusAccepted, gin.H{
		"message":   "Batch accepted",
		"processed": count,
		"total":     len(batch),
		"status":    "processing",
	})
}
