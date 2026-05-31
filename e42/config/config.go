package config

import "os"

type Config struct {
	PostgresDSN string
	RedisAddr   string
	RedisPass   string
	RedisDB     int
	ServerPort  string
	WorkerCount int
	MaxRetries  int
	StreamName  string
	ConsumerGroup string
}

func Load() *Config {
	return &Config{
		PostgresDSN:   getEnv("POSTGRES_DSN", "host=localhost user=postgres password=postgres dbname=scheduler port=5432 sslmode=disable"),
		RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPass:     getEnv("REDIS_PASS", ""),
		RedisDB:       0,
		ServerPort:    getEnv("SERVER_PORT", ":8080"),
		WorkerCount:   10,
		MaxRetries:    3,
		StreamName:    "task_stream",
		ConsumerGroup: "task_workers",
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
