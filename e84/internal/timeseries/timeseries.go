package timeseries

import (
	"sync"
	"time"
)

type DataPoint struct {
	Timestamp    time.Time `json:"timestamp"`
	AvgLatencyMs float64   `json:"avg_latency_ms"`
	MinLatencyMs float64   `json:"min_latency_ms"`
	MaxLatencyMs float64   `json:"max_latency_ms"`
	Throughput   float64   `json:"throughput"`
	Published    uint64    `json:"published"`
	Received     uint64    `json:"received"`
}

type TimeSeriesStore struct {
	mu        sync.RWMutex
	data      []DataPoint
	maxPoints int
}

func NewTimeSeriesStore(maxPoints int) *TimeSeriesStore {
	if maxPoints <= 0 {
		maxPoints = 1000
	}
	return &TimeSeriesStore{
		data:      make([]DataPoint, 0, maxPoints),
		maxPoints: maxPoints,
	}
}

func (ts *TimeSeriesStore) Add(dp DataPoint) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	ts.data = append(ts.data, dp)
	if len(ts.data) > ts.maxPoints {
		ts.data = ts.data[len(ts.data)-ts.maxPoints:]
	}
}

func (ts *TimeSeriesStore) GetAll() []DataPoint {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	result := make([]DataPoint, len(ts.data))
	copy(result, ts.data)
	return result
}

func (ts *TimeSeriesStore) GetLastN(n int) []DataPoint {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	if n >= len(ts.data) {
		result := make([]DataPoint, len(ts.data))
		copy(result, ts.data)
		return result
	}

	result := make([]DataPoint, n)
	copy(result, ts.data[len(ts.data)-n:])
	return result
}

func (ts *TimeSeriesStore) Clear() {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.data = ts.data[:0]
}

func (ts *TimeSeriesStore) Len() int {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return len(ts.data)
}
