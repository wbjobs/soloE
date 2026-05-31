package services

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"anomaly-detection-api/models"
)

type rateLimitEntry struct {
	lastTrigger time.Time
	count       int
}

type WebhookService struct {
	client     *http.Client
	rateLimit  map[string]*rateLimitEntry
	rateMutex  sync.Mutex
	maxPerMin  int
	minInterval time.Duration
}

func NewWebhookService() *WebhookService {
	return &WebhookService{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		rateLimit:   make(map[string]*rateLimitEntry),
		maxPerMin:   10,
		minInterval: 30 * time.Second,
	}
}

func (s *WebhookService) TriggerSelfHealing(config *models.WebhookConfig, event *models.AnomalyEvent) error {
	if config == nil || !config.Enabled {
		return nil
	}

	key := fmt.Sprintf("%s:%s", event.TenantID, event.DeviceID)

	if !s.checkRateLimit(key) {
		log.Printf("Webhook rate limited for %s", key)
		return fmt.Errorf("rate limited")
	}

	payload := models.WebhookPayload{
		EventID:     event.ID,
		TenantID:    event.TenantID,
		DeviceID:    event.DeviceID,
		Timestamp:   event.Timestamp,
		SensorType:  event.SensorType,
		AnomalyType: event.AnomalyType,
		Value:       event.Value,
		Expected:    event.Expected,
		Severity:    event.Severity,
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", config.URL, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Event-Type", "anomaly_detected")

	if config.Secret != "" {
		signature := generateSignature(jsonPayload, config.Secret)
		req.Header.Set("X-Signature", "sha256="+signature)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		log.Printf("Webhook request failed: %v", err)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("Webhook returned error status: %d", resp.StatusCode)
		return fmt.Errorf("webhook failed with status: %d", resp.StatusCode)
	}

	log.Printf("Webhook triggered successfully for event %s", event.ID)
	return nil
}

func (s *WebhookService) checkRateLimit(key string) bool {
	s.rateMutex.Lock()
	defer s.rateMutex.Unlock()

	now := time.Now()
	entry, exists := s.rateLimit[key]

	if !exists {
		s.rateLimit[key] = &rateLimitEntry{
			lastTrigger: now,
			count:       1,
		}
		return true
	}

	if now.Sub(entry.lastTrigger) < s.minInterval {
		return false
	}

	if now.Sub(entry.lastTrigger) > time.Minute {
		entry.count = 0
	}

	if entry.count >= s.maxPerMin {
		return false
	}

	entry.lastTrigger = now
	entry.count++

	return true
}

func generateSignature(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}
