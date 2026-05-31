package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Broker   BrokerConfig   `yaml:"broker"`
	Clients  ClientsConfig  `yaml:"clients"`
	Topics   TopicsConfig   `yaml:"topics"`
	Testing  TestingConfig  `yaml:"testing"`
	HTTPServer HTTPServerConfig `yaml:"http_server"`
	Output   OutputConfig   `yaml:"output"`
}

type BrokerConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	Protocol string `yaml:"protocol"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
	TLS      TLSConfig `yaml:"tls"`
}

type TLSConfig struct {
	Enabled        bool   `yaml:"enabled"`
	CertFile       string `yaml:"cert_file"`
	KeyFile        string `yaml:"key_file"`
	CAFile         string `yaml:"ca_file"`
	InsecureSkipVerify bool `yaml:"insecure_skip_verify"`
}

type ClientsConfig struct {
	Count                int           `yaml:"count"`
	ConnectTimeout       time.Duration `yaml:"connect_timeout"`
	KeepAlive            time.Duration `yaml:"keep_alive"`
	ClientIDPrefix       string        `yaml:"client_id_prefix"`
	MaxConcurrentConnects int          `yaml:"max_concurrent_connects"`
	ConnectDelay         time.Duration `yaml:"connect_delay"`
	MemoryMonitorInterval time.Duration `yaml:"memory_monitor_interval"`
}

type TopicsConfig struct {
	BaseTopic    string `yaml:"base_topic"`
	ShareGroup   string `yaml:"share_group"`
	UseShareSub  bool   `yaml:"use_share_sub"`
	QoS          byte   `yaml:"qos"`
}

type TestingConfig struct {
	Duration      time.Duration `yaml:"duration"`
	MessageSize   int           `yaml:"message_size"`
	PublishRate   int           `yaml:"publish_rate"`
	WarmupPeriod  time.Duration `yaml:"warmup_period"`
}

type HTTPServerConfig struct {
	Enabled bool   `yaml:"enabled"`
	Host    string `yaml:"host"`
	Port    int    `yaml:"port"`
}

type OutputConfig struct {
	CSVFile     string `yaml:"csv_file"`
	Interval    time.Duration `yaml:"interval"`
	ConsolePrint bool `yaml:"console_print"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	cfg.setDefaults()

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func (c *Config) setDefaults() {
	if c.Broker.Protocol == "" {
		c.Broker.Protocol = "tcp"
	}
	if c.Broker.Host == "" {
		c.Broker.Host = "localhost"
	}
	if c.Broker.Port == 0 {
		if c.Broker.TLS.Enabled {
			c.Broker.Port = 8883
		} else {
			c.Broker.Port = 1883
		}
	}
	if c.Clients.Count == 0 {
		c.Clients.Count = 10
	}
	if c.Clients.ConnectTimeout == 0 {
		c.Clients.ConnectTimeout = 10 * time.Second
	}
	if c.Clients.KeepAlive == 0 {
		c.Clients.KeepAlive = 60 * time.Second
	}
	if c.Clients.ClientIDPrefix == "" {
		c.Clients.ClientIDPrefix = "load-tester"
	}
	if c.Clients.MaxConcurrentConnects == 0 {
		c.Clients.MaxConcurrentConnects = 50
	}
	if c.Clients.ConnectDelay == 0 {
		c.Clients.ConnectDelay = 100 * time.Millisecond
	}
	if c.Clients.MemoryMonitorInterval == 0 {
		c.Clients.MemoryMonitorInterval = 30 * time.Second
	}
	if c.Topics.BaseTopic == "" {
		c.Topics.BaseTopic = "test/topic"
	}
	if c.Topics.ShareGroup == "" {
		c.Topics.ShareGroup = "load-test-group"
	}
	if c.Testing.Duration == 0 {
		c.Testing.Duration = 60 * time.Second
	}
	if c.Testing.MessageSize == 0 {
		c.Testing.MessageSize = 100
	}
	if c.Testing.PublishRate == 0 {
		c.Testing.PublishRate = 10
	}
	if c.HTTPServer.Host == "" {
		c.HTTPServer.Host = "localhost"
	}
	if c.HTTPServer.Port == 0 {
		c.HTTPServer.Port = 8080
	}
	if c.Output.CSVFile == "" {
		c.Output.CSVFile = "mqtt_load_test_report.csv"
	}
	if c.Output.Interval == 0 {
		c.Output.Interval = 5 * time.Second
	}
}

func (c *Config) validate() error {
	if c.Clients.Count <= 0 {
		return fmt.Errorf("clients.count must be greater than 0")
	}
	if c.Testing.MessageSize <= 0 {
		return fmt.Errorf("testing.message_size must be greater than 0")
	}
	if c.Testing.PublishRate <= 0 {
		return fmt.Errorf("testing.publish_rate must be greater than 0")
	}
	if c.Broker.Protocol != "tcp" && c.Broker.Protocol != "ssl" && c.Broker.Protocol != "tls" {
		return fmt.Errorf("broker.protocol must be one of: tcp, ssl, tls")
	}
	if c.Topics.QoS > 2 {
		return fmt.Errorf("topics.qos must be 0, 1, or 2")
	}
	return nil
}

func (c *Config) BrokerURL() string {
	scheme := c.Broker.Protocol
	if c.Broker.TLS.Enabled && scheme == "tcp" {
		scheme = "ssl"
	}
	return fmt.Sprintf("%s://%s:%d", scheme, c.Broker.Host, c.Broker.Port)
}

func (c *Config) GetSubscribeTopic() string {
	if c.Topics.UseShareSub {
		return fmt.Sprintf("$share/%s/%s", c.Topics.ShareGroup, c.Topics.BaseTopic)
	}
	return c.Topics.BaseTopic
}

func (c *Config) GetPublishTopic() string {
	return c.Topics.BaseTopic
}
