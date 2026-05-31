package models

import "time"

type Tenant struct {
	ID        string    `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	APIKey    string    `json:"api_key" db:"api_key"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type SensorData struct {
	ID          string    `json:"id" db:"id"`
	TenantID    string    `json:"tenant_id" db:"tenant_id"`
	DeviceID    string    `json:"device_id" db:"device_id" binding:"required"`
	Timestamp   time.Time `json:"timestamp" db:"timestamp"`
	Temperature float64   `json:"temperature" db:"temperature" binding:"required"`
	Vibration   float64   `json:"vibration" db:"vibration" binding:"required"`
	Current     float64   `json:"current" db:"current" binding:"required"`
}

type AnomalyType string

const (
	AnomalySpike    AnomalyType = "spike"
	AnomalyStep     AnomalyType = "step"
	AnomalyDrift    AnomalyType = "drift"
)

type AnomalyEvent struct {
	ID          string      `json:"id" db:"id"`
	TenantID    string      `json:"tenant_id" db:"tenant_id"`
	DeviceID    string      `json:"device_id" db:"device_id"`
	Timestamp   time.Time   `json:"timestamp" db:"timestamp"`
	SensorType  string      `json:"sensor_type" db:"sensor_type"`
	AnomalyType AnomalyType `json:"anomaly_type" db:"anomaly_type"`
	Value       float64     `json:"value" db:"value"`
	Expected    float64     `json:"expected" db:"expected"`
	Severity    float64     `json:"severity" db:"severity"`
	Resolved    bool        `json:"resolved" db:"resolved"`
}

type WebhookConfig struct {
	ID          string    `json:"id" db:"id"`
	TenantID    string    `json:"tenant_id" db:"tenant_id"`
	URL         string    `json:"url" db:"url"`
	Secret      string    `json:"secret" db:"secret"`
	Enabled     bool      `json:"enabled" db:"enabled"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

type WebhookPayload struct {
	EventID     string      `json:"event_id"`
	TenantID    string      `json:"tenant_id"`
	DeviceID    string      `json:"device_id"`
	Timestamp   time.Time   `json:"timestamp"`
	SensorType  string      `json:"sensor_type"`
	AnomalyType AnomalyType `json:"anomaly_type"`
	Value       float64     `json:"value"`
	Expected    float64     `json:"expected"`
	Severity    float64     `json:"severity"`
}
