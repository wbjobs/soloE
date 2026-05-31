package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"anomaly-detection-api/db"
	"anomaly-detection-api/models"
)

func InsertSensorData(ctx context.Context, data *models.SensorData) error {
	query := `
		INSERT INTO sensor_data (tenant_id, device_id, timestamp, temperature, vibration, current)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`
	return db.Pool.QueryRow(ctx, query,
		data.TenantID, data.DeviceID, data.Timestamp,
		data.Temperature, data.Vibration, data.Current,
	).Scan(&data.ID)
}

func BatchInsertSensorData(ctx context.Context, data []*models.SensorData) error {
	if len(data) == 0 {
		return nil
	}

	rows := make([][]interface{}, len(data))
	for i, d := range data {
		rows[i] = []interface{}{
			d.TenantID, d.DeviceID, d.Timestamp,
			d.Temperature, d.Vibration, d.Current,
		}
	}

	copyCount, err := db.Pool.CopyFrom(
		ctx,
		pgx.Identifier{"sensor_data"},
		[]string{"tenant_id", "device_id", "timestamp", "temperature", "vibration", "current"},
		pgx.CopyFromRows(rows),
	)

	if err != nil {
		return fmt.Errorf("batch insert failed: %w", err)
	}

	if int(copyCount) != len(data) {
		return fmt.Errorf("expected to insert %d rows, got %d", len(data), copyCount)
	}

	return nil
}

func GetSensorDataByDevice(ctx context.Context, tenantID, deviceID string, startTime, endTime time.Time) ([]models.SensorData, error) {
	query := `
		SELECT id, tenant_id, device_id, timestamp, temperature, vibration, current
		FROM sensor_data
		WHERE tenant_id = $1 AND device_id = $2 AND timestamp BETWEEN $3 AND $4
		ORDER BY timestamp ASC
	`
	rows, err := db.Pool.Query(ctx, query, tenantID, deviceID, startTime, endTime)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var data []models.SensorData
	for rows.Next() {
		var d models.SensorData
		err := rows.Scan(&d.ID, &d.TenantID, &d.DeviceID, &d.Timestamp,
			&d.Temperature, &d.Vibration, &d.Current)
		if err != nil {
			return nil, err
		}
		data = append(data, d)
	}
	return data, nil
}

func GetRecentSensorData(ctx context.Context, tenantID, deviceID string, limit int) ([]models.SensorData, error) {
	query := `
		SELECT id, tenant_id, device_id, timestamp, temperature, vibration, current
		FROM sensor_data
		WHERE tenant_id = $1 AND device_id = $2
		ORDER BY timestamp DESC
		LIMIT $3
	`
	rows, err := db.Pool.Query(ctx, query, tenantID, deviceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var data []models.SensorData
	for rows.Next() {
		var d models.SensorData
		err := rows.Scan(&d.ID, &d.TenantID, &d.DeviceID, &d.Timestamp,
			&d.Temperature, &d.Vibration, &d.Current)
		if err != nil {
			return nil, err
		}
		data = append(data, d)
	}
	return data, nil
}
