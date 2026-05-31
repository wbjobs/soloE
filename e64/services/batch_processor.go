package services

import (
	"context"
	"log"
	"sync"
	"time"

	"anomaly-detection-api/models"
	"anomaly-detection-api/repository"
)

type BatchProcessor struct {
	buffer        map[string][]*models.SensorData
	bufferMutex   sync.Mutex
	batchSize     int
	flushInterval time.Duration
	stopChan      chan struct{}
	webhookSvc    *WebhookService
}

func NewBatchProcessor(batchSize int, flushInterval time.Duration) *BatchProcessor {
	bp := &BatchProcessor{
		buffer:        make(map[string][]*models.SensorData),
		batchSize:     batchSize,
		flushInterval: flushInterval,
		stopChan:      make(chan struct{}),
		webhookSvc:    NewWebhookService(),
	}
	go bp.startFlusher()
	return bp
}

func (bp *BatchProcessor) AddData(ctx context.Context, data *models.SensorData) error {
	key := data.TenantID + ":" + data.DeviceID

	bp.bufferMutex.Lock()
	bp.buffer[key] = append(bp.buffer[key], data)
	currentSize := len(bp.buffer[key])
	bp.bufferMutex.Unlock()

	if currentSize >= bp.batchSize {
		go bp.flushKey(key)
	}

	return nil
}

func (bp *BatchProcessor) startFlusher() {
	ticker := time.NewTicker(bp.flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			bp.flushAll()
		case <-bp.stopChan:
			return
		}
	}
}

func (bp *BatchProcessor) flushKey(key string) {
	bp.bufferMutex.Lock()
	data, exists := bp.buffer[key]
	if exists {
		bp.buffer[key] = nil
	}
	bp.bufferMutex.Unlock()

	if !exists || len(data) == 0 {
		return
	}

	if err := bp.batchInsert(context.Background(), data); err != nil {
		log.Printf("Batch insert error: %v", err)
		return
	}

	go bp.processBatchAnomalies(data)
}

func (bp *BatchProcessor) flushAll() {
	bp.bufferMutex.Lock()
	allData := make(map[string][]*models.SensorData)
	for k, v := range bp.buffer {
		if len(v) > 0 {
			allData[k] = v
			bp.buffer[k] = nil
		}
	}
	bp.bufferMutex.Unlock()

	for key, data := range allData {
		if err := bp.batchInsert(context.Background(), data); err != nil {
			log.Printf("Batch insert error for %s: %v", key, err)
			continue
		}
		go bp.processBatchAnomalies(data)
	}
}

func (bp *BatchProcessor) batchInsert(ctx context.Context, data []*models.SensorData) error {
	if len(data) == 0 {
		return nil
	}

	if err := repository.BatchInsertSensorData(ctx, data); err != nil {
		log.Printf("Batch insert error: %v", err)
		return err
	}
	return nil
}

func (bp *BatchProcessor) processBatchAnomalies(data []*models.SensorData) {
	if len(data) == 0 {
		return
	}

	tenantID := data[0].TenantID
	deviceID := data[0].DeviceID

	ctx := context.Background()
	historyData, err := repository.GetRecentSensorData(ctx, tenantID, deviceID, 200)
	if err != nil {
		log.Printf("Failed to get history data: %v", err)
		return
	}

	if len(historyData) < 20 {
		return
	}

	sensors := []string{"temperature", "vibration", "current"}

	for _, sensorType := range sensors {
		historyValues := extractSensorValuesFromPtr(historyData, sensorType)
		currentValues := extractSensorValuesFromPtr(data, sensorType)

		anomalies := DetectWithSTLBatch(historyValues, currentValues)

		for i, result := range anomalies {
			if result.IsAnomaly {
				value := currentValues[i]
				event := &models.AnomalyEvent{
					TenantID:    tenantID,
					DeviceID:    deviceID,
					Timestamp:   data[i].Timestamp,
					SensorType:  sensorType,
					AnomalyType: models.AnomalyType(result.AnomalyType),
					Value:       value,
					Expected:    result.Expected,
					Severity:    result.Severity,
					Resolved:    false,
				}

				if err := repository.InsertAnomalyEvent(ctx, event); err != nil {
					log.Printf("Failed to insert anomaly event: %v", err)
					continue
				}

				log.Printf("Anomaly detected: %s - %s - %f", event.DeviceID, event.AnomalyType, event.Value)

				webhookConfig, err := repository.GetWebhookConfigByTenant(ctx, tenantID)
				if err == nil {
					go bp.webhookSvc.TriggerSelfHealing(webhookConfig, event)
				}
			}
		}
	}
}

func extractSensorValuesFromPtr(data []*models.SensorData, sensorType string) []float64 {
	values := make([]float64, 0, len(data))
	for _, d := range data {
		switch sensorType {
		case "temperature":
			values = append(values, d.Temperature)
		case "vibration":
			values = append(values, d.Vibration)
		case "current":
			values = append(values, d.Current)
		}
	}
	return values
}

func (bp *BatchProcessor) Stop() {
	close(bp.stopChan)
	bp.flushAll()
}
