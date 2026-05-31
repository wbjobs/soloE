package repository

import (
	"context"
	"time"

	"anomaly-detection-api/db"
	"anomaly-detection-api/models"
)

func InsertAnomalyEvent(ctx context.Context, event *models.AnomalyEvent) error {
	query := `
		INSERT INTO anomaly_events (tenant_id, device_id, timestamp, sensor_type, anomaly_type, value, expected, severity, resolved)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`
	return db.Pool.QueryRow(ctx, query,
		event.TenantID, event.DeviceID, event.Timestamp,
		event.SensorType, event.AnomalyType,
		event.Value, event.Expected, event.Severity, event.Resolved,
	).Scan(&event.ID)
}

func GetAnomalyEvents(ctx context.Context, tenantID string, startTime, endTime time.Time, anomalyType string) ([]models.AnomalyEvent, error) {
	query := `
		SELECT id, tenant_id, device_id, timestamp, sensor_type, anomaly_type, value, expected, severity, resolved
		FROM anomaly_events
		WHERE tenant_id = $1 AND timestamp BETWEEN $2 AND $3
	`
	args := []interface{}{tenantID, startTime, endTime}
	argIndex := 4

	if anomalyType != "" {
		query += ` AND anomaly_type = $` + string(rune(argIndex))
		args = append(args, anomalyType)
	}
	query += ` ORDER BY timestamp DESC`

	rows, err := db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []models.AnomalyEvent
	for rows.Next() {
		var e models.AnomalyEvent
		err := rows.Scan(&e.ID, &e.TenantID, &e.DeviceID, &e.Timestamp,
			&e.SensorType, &e.AnomalyType, &e.Value, &e.Expected,
			&e.Severity, &e.Resolved)
		if err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}
