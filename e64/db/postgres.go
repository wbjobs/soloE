package db

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"anomaly-detection-api/config"
)

var Pool *pgxpool.Pool

func InitDB(cfg *config.Config) error {
	connStr := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable",
		cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName)

	poolConfig, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return fmt.Errorf("failed to parse pool config: %w", err)
	}

	Pool, err = pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		return fmt.Errorf("failed to create connection pool: %w", err)
	}

	if err := Pool.Ping(context.Background()); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	log.Println("Successfully connected to TimescaleDB")
	return nil
}

func InitSchema() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS tenants (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL,
			api_key VARCHAR(255) UNIQUE NOT NULL,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		
		`CREATE INDEX IF NOT EXISTS idx_tenants_api_key ON tenants(api_key)`,
		
		`CREATE TABLE IF NOT EXISTS sensor_data (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			tenant_id UUID NOT NULL REFERENCES tenants(id),
			device_id VARCHAR(255) NOT NULL,
			timestamp TIMESTAMPTZ NOT NULL,
			temperature DOUBLE PRECISION NOT NULL,
			vibration DOUBLE PRECISION NOT NULL,
			current DOUBLE PRECISION NOT NULL
		)`,
		
		`SELECT create_hypertable('sensor_data', 'timestamp', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 hour')`,
		
		`CREATE INDEX IF NOT EXISTS idx_sensor_data_tenant_device_ts ON sensor_data(tenant_id, device_id, timestamp DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_sensor_data_device_ts ON sensor_data(device_id, timestamp DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_sensor_data_tenant_ts ON sensor_data(tenant_id, timestamp DESC)`,
		
		`ALTER TABLE sensor_data SET (timescaledb.compress, timescaledb.compress_segmentby = 'tenant_id, device_id')`,
		
		`SELECT add_compression_policy('sensor_data', INTERVAL '7 days', if_not_exists => TRUE)`,
		
		`CREATE TABLE IF NOT EXISTS anomaly_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			tenant_id UUID NOT NULL REFERENCES tenants(id),
			device_id VARCHAR(255) NOT NULL,
			timestamp TIMESTAMPTZ NOT NULL,
			sensor_type VARCHAR(50) NOT NULL,
			anomaly_type VARCHAR(50) NOT NULL,
			value DOUBLE PRECISION NOT NULL,
			expected DOUBLE PRECISION NOT NULL,
			severity DOUBLE PRECISION NOT NULL,
			resolved BOOLEAN DEFAULT FALSE
		)`,
		
		`SELECT create_hypertable('anomaly_events', 'timestamp', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 day')`,
		
		`CREATE INDEX IF NOT EXISTS idx_anomaly_events_tenant_ts ON anomaly_events(tenant_id, timestamp DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_anomaly_events_tenant_type ON anomaly_events(tenant_id, anomaly_type, timestamp DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_anomaly_events_device ON anomaly_events(device_id, timestamp DESC)`,
		
		`CREATE TABLE IF NOT EXISTS webhook_configs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			tenant_id UUID NOT NULL REFERENCES tenants(id),
			url VARCHAR(500) NOT NULL,
			secret VARCHAR(255),
			enabled BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		
		`CREATE INDEX IF NOT EXISTS idx_webhook_configs_tenant ON webhook_configs(tenant_id, enabled)`,
	}

	for _, query := range queries {
		_, err := Pool.Exec(context.Background(), query)
		if err != nil {
			log.Printf("Warning executing query: %v", err)
		}
	}

	log.Println("Database schema initialized successfully")
	return nil
}

func CloseDB() {
	if Pool != nil {
		Pool.Close()
	}
}
