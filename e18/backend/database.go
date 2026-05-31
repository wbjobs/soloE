package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

var db *pgx.Conn

func InitDB() error {
	connStr := os.Getenv("DATABASE_URL")
	if connStr == "" {
		connStr = "postgres://postgres:postgres@localhost:5432/health_db?sslmode=disable"
	}

	var err error
	db, err = pgx.Connect(context.Background(), connStr)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	if err := createTables(); err != nil {
		return fmt.Errorf("failed to create tables: %w", err)
	}

	return nil
}

func createTables() error {
	stepsTable := `
	CREATE TABLE IF NOT EXISTS steps (
		id SERIAL PRIMARY KEY,
		date DATE NOT NULL,
		steps INTEGER NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(date)
	)`

	heartRateTable := `
	CREATE TABLE IF NOT EXISTS heart_rate (
		id SERIAL PRIMARY KEY,
		date DATE NOT NULL,
		heart_rate INTEGER NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(date)
	)`

	_, err := db.Exec(context.Background(), stepsTable)
	if err != nil {
		return err
	}

	_, err = db.Exec(context.Background(), heartRateTable)
	return err
}

func InsertSteps(date time.Time, steps int) error {
	query := `
	INSERT INTO steps (date, steps)
	VALUES ($1, $2)
	ON CONFLICT (date) DO UPDATE SET steps = $2`

	_, err := db.Exec(context.Background(), query, date, steps)
	return err
}

func InsertHeartRate(date time.Time, heartRate int) error {
	query := `
	INSERT INTO heart_rate (date, heart_rate)
	VALUES ($1, $2)
	ON CONFLICT (date) DO UPDATE SET heart_rate = $2`

	_, err := db.Exec(context.Background(), query, date, heartRate)
	return err
}

func GetAverageStepsLast7Days() (float64, error) {
	query := `
	SELECT COALESCE(AVG(steps), 0)
	FROM steps
	WHERE date >= CURRENT_DATE - INTERVAL '7 days'`

	var avg float64
	err := db.QueryRow(context.Background(), query).Scan(&avg)
	return avg, err
}

func GetMaxHeartRateLast7Days() (int, error) {
	query := `
	SELECT COALESCE(MAX(heart_rate), 0)
	FROM heart_rate
	WHERE date >= CURRENT_DATE - INTERVAL '7 days'`

	var max int
	err := db.QueryRow(context.Background(), query).Scan(&max)
	return max, err
}

type StepRecord struct {
	Date  time.Time
	Steps int
}

type HeartRateRecord struct {
	Date      time.Time
	HeartRate int
}

func GetAllSteps() ([]StepRecord, error) {
	query := `
	SELECT date, steps
	FROM steps
	ORDER BY date DESC`

	rows, err := db.Query(context.Background(), query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []StepRecord
	for rows.Next() {
		var r StepRecord
		if err := rows.Scan(&r.Date, &r.Steps); err != nil {
			return nil, err
		}
		records = append(records, r)
	}

	return records, rows.Err()
}

func GetAllHeartRates() ([]HeartRateRecord, error) {
	query := `
	SELECT date, heart_rate
	FROM heart_rate
	ORDER BY date DESC`

	rows, err := db.Query(context.Background(), query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []HeartRateRecord
	for rows.Next() {
		var r HeartRateRecord
		if err := rows.Scan(&r.Date, &r.HeartRate); err != nil {
			return nil, err
		}
		records = append(records, r)
	}

	return records, rows.Err()
}
