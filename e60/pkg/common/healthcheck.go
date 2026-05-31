package common

import (
	"context"
	"log"
	"net"
	"net/http"
	"sync"
	"time"
)

type HealthCheckType string

const (
	HealthCheckTCP  HealthCheckType = "tcp"
	HealthCheckHTTP HealthCheckType = "http"
)

type HealthChecker struct {
	backends    []*Backend
	checkType   HealthCheckType
	interval    time.Duration
	timeout     time.Duration
	path        string
	stopChan    chan struct{}
	running     bool
	mu          sync.Mutex
}

func NewHealthChecker(checkType HealthCheckType, interval, timeout time.Duration) *HealthChecker {
	return &HealthChecker{
		checkType: checkType,
		interval:  interval,
		timeout:   timeout,
		stopChan:  make(chan struct{}),
	}
}

func (hc *HealthChecker) AddBackend(backend *Backend) {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	hc.backends = append(hc.backends, backend)
}

func (hc *HealthChecker) RemoveBackend(address string) {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	for i, b := range hc.backends {
		if b.Address == address {
			hc.backends = append(hc.backends[:i], hc.backends[i+1:]...)
			return
		}
	}
}

func (hc *HealthChecker) SetHTTPPath(path string) {
	hc.path = path
}

func (hc *HealthChecker) Start() {
	hc.mu.Lock()
	if hc.running {
		hc.mu.Unlock()
		return
	}
	hc.running = true
	hc.mu.Unlock()

	go hc.run()
}

func (hc *HealthChecker) Stop() {
	hc.mu.Lock()
	defer hc.mu.Unlock()
	if hc.running {
		close(hc.stopChan)
		hc.running = false
	}
}

func (hc *HealthChecker) run() {
	ticker := time.NewTicker(hc.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			hc.checkAll()
		case <-hc.stopChan:
			return
		}
	}
}

func (hc *HealthChecker) checkAll() {
	hc.mu.Lock()
	backends := make([]*Backend, len(hc.backends))
	copy(backends, hc.backends)
	hc.mu.Unlock()

	var wg sync.WaitGroup
	for _, backend := range backends {
		wg.Add(1)
		go func(b *Backend) {
			defer wg.Done()
			hc.checkBackend(b)
		}(backend)
	}
	wg.Wait()
}

func (hc *HealthChecker) checkBackend(backend *Backend) {
	ctx, cancel := context.WithTimeout(context.Background(), hc.timeout)
	defer cancel()

	var err error
	switch hc.checkType {
	case HealthCheckTCP:
		err = hc.checkTCP(ctx, backend.Address)
	case HealthCheckHTTP:
		err = hc.checkHTTP(ctx, backend.Address)
	default:
		err = hc.checkTCP(ctx, backend.Address)
	}

	if err != nil {
		log.Printf("Health check failed for %s: %v", backend.Address, err)
		backend.MarkUnhealthy()
	} else {
		backend.MarkHealthy()
	}
}

func (hc *HealthChecker) checkTCP(ctx context.Context, address string) error {
	dialer := &net.Dialer{}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer conn.Close()
	return nil
}

func (hc *HealthChecker) checkHTTP(ctx context.Context, address string) error {
	client := &http.Client{
		Timeout: hc.timeout,
	}

	url := "http://" + address + hc.path
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		return &HTTPHealthError{StatusCode: resp.StatusCode}
	}

	return nil
}

type HTTPHealthError struct {
	StatusCode int
}

func (e *HTTPHealthError) Error() string {
	return "HTTP health check failed with status code: " + string(rune(e.StatusCode))
}

func (hc *HealthChecker) GetHealthyBackends() []*Backend {
	hc.mu.Lock()
	defer hc.mu.Unlock()

	healthy := make([]*Backend, 0)
	for _, b := range hc.backends {
		b.mu.RLock()
		if b.Healthy {
			healthy = append(healthy, b)
		}
		b.mu.RUnlock()
	}
	return healthy
}

func (hc *HealthChecker) GetBackendStats() map[string]map[string]interface{} {
	hc.mu.Lock()
	defer hc.mu.Unlock()

	stats := make(map[string]map[string]interface{})
	for _, b := range hc.backends {
		healthy, failCount, successCount, load := b.GetStats()
		stats[b.Address] = map[string]interface{}{
			"healthy":      healthy,
			"fail_count":   failCount,
			"success_count": successCount,
			"load":         load,
		}
	}
	return stats
}
