package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server        ServerConfig   `yaml:"server"`
	Concurrency   int            `yaml:"concurrency"`
	RequestsPerSec int           `yaml:"requests_per_second"`
	RequestBody   int            `yaml:"request_body_size_bytes"`
	RequestCount  int            `yaml:"request_count"`
	Duration      int            `yaml:"duration_seconds"`
	OutputFile    string         `yaml:"output_csv_file"`
}

type ServerConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	Path     string `yaml:"path"`
	Method   string `yaml:"method"`
	Insecure bool   `yaml:"insecure"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func DefaultConfig() *Config {
	return &Config{
		Server: ServerConfig{
			Host:     "localhost",
			Port:     443,
			Path:     "/",
			Method:   "GET",
			Insecure: true,
		},
		Concurrency:    100,
		RequestsPerSec: 1000,
		RequestBody:    0,
		RequestCount:   0,
		Duration:       60,
		OutputFile:     "report.csv",
	}
}
