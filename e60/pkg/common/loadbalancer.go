package common

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math/rand"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Backend struct {
	Address    string
	Weight     int
	Healthy    bool
	FailCount  int
	SuccessCount int
	LastCheck time.Time
	Load       int64
	mu         sync.RWMutex
}

type RouteRule struct {
	ID           string
	PathPattern  string
	HeaderMatch  map[string]string
	Backends     []*Backend
	Strategy     LoadBalanceStrategy
	Regex        *regexp.Regexp
}

type LoadBalanceStrategy int

const (
	StrategyRoundRobin LoadBalanceStrategy = iota
	StrategyWeightedRoundRobin
	StrategyLeastConnections
	StrategyIPHash
	StrategyRandom
)

type LoadBalancer struct {
	routes      map[string]*RouteRule
	defaultRoute *RouteRule
	mu          sync.RWMutex
}

func NewLoadBalancer() *LoadBalancer {
	return &LoadBalancer{
		routes: make(map[string]*RouteRule),
	}
}

func (lb *LoadBalancer) AddRoute(rule *RouteRule) error {
	if rule.PathPattern != "" {
		regex, err := regexp.Compile(rule.PathPattern)
		if err != nil {
			return fmt.Errorf("invalid path pattern: %w", err)
		}
		rule.Regex = regex
	}

	lb.mu.Lock()
	defer lb.mu.Unlock()
	lb.routes[rule.ID] = rule

	if lb.defaultRoute == nil && rule.ID == "default" {
		lb.defaultRoute = rule
	}

	return nil
}

func (lb *LoadBalancer) SetDefaultRoute(rule *RouteRule) {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	lb.defaultRoute = rule
}

func (lb *LoadBalancer) MatchRoute(path string, headers http.Header) *RouteRule {
	lb.mu.RLock()
	defer lb.mu.RUnlock()

	for _, rule := range lb.routes {
		if rule.Regex != nil && rule.Regex.MatchString(path) {
			if len(rule.HeaderMatch) > 0 {
				match := true
				for k, v := range rule.HeaderMatch {
					if !strings.Contains(headers.Get(k), v) {
						match = false
						break
					}
				}
				if match {
					return rule
				}
			} else {
				return rule
			}
		}
	}

	return lb.defaultRoute
}

func (lb *LoadBalancer) SelectBackend(rule *RouteRule, clientIP string) *Backend {
	if rule == nil {
		return nil
	}

	healthyBackends := make([]*Backend, 0)
	for _, b := range rule.Backends {
		b.mu.RLock()
		if b.Healthy {
			healthyBackends = append(healthyBackends, b)
		}
		b.mu.RUnlock()
	}

	if len(healthyBackends) == 0 {
		return nil
	}

	switch rule.Strategy {
	case StrategyRoundRobin:
		return roundRobin(healthyBackends)
	case StrategyWeightedRoundRobin:
		return weightedRoundRobin(healthyBackends)
	case StrategyLeastConnections:
		return leastConnections(healthyBackends)
	case StrategyIPHash:
		return ipHash(healthyBackends, clientIP)
	case StrategyRandom:
		return random(healthyBackends)
	default:
		return roundRobin(healthyBackends)
	}
}

var rrCounter uint32

func roundRobin(backends []*Backend) *Backend {
	if len(backends) == 0 {
		return nil
	}
	idx := int(atomicAddUint32(&rrCounter, 1)) % len(backends)
	return backends[idx]
}

func atomicAddUint32(addr *uint32, delta uint32) uint32 {
	return *addr + delta
}

var wrrCounter map[string]int
var wrrMu sync.Mutex

func weightedRoundRobin(backends []*Backend) *Backend {
	if len(backends) == 0 {
		return nil
	}

	wrrMu.Lock()
	defer wrrMu.Unlock()

	if wrrCounter == nil {
		wrrCounter = make(map[string]int)
	}

	totalWeight := 0
	for _, b := range backends {
		totalWeight += b.Weight
	}

	for i, b := range backends {
		key := fmt.Sprintf("%p", b)
		current := wrrCounter[key]
		current += b.Weight
		wrrCounter[key] = current

		if current >= totalWeight {
			wrrCounter[key] = 0
			return backends[i]
		}
	}

	return backends[0]
}

func leastConnections(backends []*Backend) *Backend {
	if len(backends) == 0 {
		return nil
	}

	minLoad := int64(-1)
	selected := 0
	for i, b := range backends {
		b.mu.RLock()
		load := b.Load
		b.mu.RUnlock()

		if minLoad == -1 || load < minLoad {
			minLoad = load
			selected = i
		}
	}

	return backends[selected]
}

func ipHash(backends []*Backend, clientIP string) *Backend {
	if len(backends) == 0 {
		return nil
	}

	hash := sha256.Sum256([]byte(clientIP))
	idx := int(binary.BigEndian.Uint32(hash[:4])) % len(backends)
	return backends[idx]
}

func random(backends []*Backend) *Backend {
	if len(backends) == 0 {
		return nil
	}
	return backends[rand.Intn(len(backends))]
}

func (b *Backend) IncrementLoad() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.Load++
}

func (b *Backend) DecrementLoad() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.Load > 0 {
		b.Load--
	}
}

func (b *Backend) MarkHealthy() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.Healthy = true
	b.FailCount = 0
	b.SuccessCount++
	b.LastCheck = time.Now()
}

func (b *Backend) MarkUnhealthy() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.FailCount++
	b.SuccessCount = 0
	b.LastCheck = time.Now()
	if b.FailCount >= 3 {
		b.Healthy = false
	}
}

func (b *Backend) GetStats() (bool, int, int, int64) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.Healthy, b.FailCount, b.SuccessCount, b.Load
}
