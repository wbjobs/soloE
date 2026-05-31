package stats

import (
	"sort"
	"sync"
	"time"
)

type Metrics struct {
	ConnectionTimes    []time.Duration
	RequestRTTs        []time.Duration
	Retransmissions    uint64
	PacketsLost        uint64
	TotalRequests      uint64
	FailedRequests     uint64
	SessionReused      uint64
	SessionNew         uint64
	SessionTotal       uint64
	mu                 sync.Mutex
}

func NewMetrics() *Metrics {
	return &Metrics{
		ConnectionTimes: make([]time.Duration, 0),
		RequestRTTs:     make([]time.Duration, 0),
	}
}

func (m *Metrics) RecordConnectionTime(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ConnectionTimes = append(m.ConnectionTimes, d)
}

func (m *Metrics) RecordRequestRTT(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.RequestRTTs = append(m.RequestRTTs, d)
}

func (m *Metrics) IncrementRetransmissions(count uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Retransmissions += count
}

func (m *Metrics) IncrementPacketsLost(count uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.PacketsLost += count
}

func (m *Metrics) IncrementTotalRequests() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.TotalRequests++
}

func (m *Metrics) IncrementFailedRequests() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.FailedRequests++
}

func (m *Metrics) RecordSessionReused() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.SessionReused++
	m.SessionTotal++
}

func (m *Metrics) RecordSessionNew() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.SessionNew++
	m.SessionTotal++
}

func (m *Metrics) GetSessionReuseRate() float64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.SessionTotal == 0 {
		return 0
	}
	return float64(m.SessionReused) / float64(m.SessionTotal) * 100
}

func (m *Metrics) GetSessionStats() (reused, new, total uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.SessionReused, m.SessionNew, m.SessionTotal
}

func (m *Metrics) SetSessionStats(reused, new, total uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.SessionReused = reused
	m.SessionNew = new
	m.SessionTotal = total
}

type Percentiles struct {
	P50 time.Duration
	P95 time.Duration
	P99 time.Duration
}

func (m *Metrics) GetConnectionTimePercentiles() Percentiles {
	m.mu.Lock()
	defer m.mu.Unlock()
	return calculatePercentiles(m.ConnectionTimes)
}

func (m *Metrics) GetRTTPercentiles() Percentiles {
	m.mu.Lock()
	defer m.mu.Unlock()
	return calculatePercentiles(m.RequestRTTs)
}

func calculatePercentiles(data []time.Duration) Percentiles {
	if len(data) == 0 {
		return Percentiles{}
	}

	sorted := make([]time.Duration, len(data))
	copy(sorted, data)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i] < sorted[j]
	})

	n := len(sorted)
	p50Idx := int(float64(n) * 0.50)
	p95Idx := int(float64(n) * 0.95)
	p99Idx := int(float64(n) * 0.99)

	if p50Idx >= n {
		p50Idx = n - 1
	}
	if p95Idx >= n {
		p95Idx = n - 1
	}
	if p99Idx >= n {
		p99Idx = n - 1
	}

	return Percentiles{
		P50: sorted[p50Idx],
		P95: sorted[p95Idx],
		P99: sorted[p99Idx],
	}
}

func (m *Metrics) GetAverages() (avgConnTime, avgRTT time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.ConnectionTimes) > 0 {
		var total time.Duration
		for _, t := range m.ConnectionTimes {
			total += t
		}
		avgConnTime = total / time.Duration(len(m.ConnectionTimes))
	}

	if len(m.RequestRTTs) > 0 {
		var total time.Duration
		for _, t := range m.RequestRTTs {
			total += t
		}
		avgRTT = total / time.Duration(len(m.RequestRTTs))
	}

	return
}

func (m *Metrics) GetCounts() (totalReq, failedReq uint64, retrans, lost uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.TotalRequests, m.FailedRequests, m.Retransmissions, m.PacketsLost
}

func (m *Metrics) GetConnectionCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.ConnectionTimes)
}
