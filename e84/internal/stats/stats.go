package stats

import (
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type MessageRecord struct {
	MessageID   uint64
	PublishTime time.Time
	ReceiveTime time.Time
	Latency     time.Duration
}

type Statistics struct {
	mu sync.RWMutex

	totalPublished   uint64
	totalReceived    uint64
	totalLost        uint64
	totalOutOfOrder  uint64

	latencies        []time.Duration
	lastReceivedID   uint64
	firstMessageID   uint64
	hasFirstMessage  bool

	startTime        time.Time
	endTime          time.Time
	isRunning        bool

	windowStats      *WindowStats
}

type WindowStats struct {
	mu               sync.RWMutex
	Published        uint64
	Received         uint64
	Lost             uint64
	OutOfOrder       uint64
	Latencies        []time.Duration
	WindowStart      time.Time
	WindowDuration   time.Duration
}

type StatsSummary struct {
	TotalPublished   uint64
	TotalReceived    uint64
	TotalLost        uint64
	TotalOutOfOrder  uint64
	ReceiveRate      float64
	Throughput       float64
	LossRate         float64
	OutOfOrderRate   float64
	AvgLatency       time.Duration
	MinLatency       time.Duration
	MaxLatency       time.Duration
	P50Latency       time.Duration
	P95Latency       time.Duration
	P99Latency       time.Duration
	TestDuration     time.Duration
}

type WindowSummary struct {
	Published        uint64
	Received         uint64
	Lost             uint64
	OutOfOrder       uint64
	ReceiveRate      float64
	Throughput       float64
	AvgLatency       time.Duration
	MinLatency       time.Duration
	MaxLatency       time.Duration
	WindowDuration   time.Duration
}

func NewStatistics() *Statistics {
	return &Statistics{
		latencies: make([]time.Duration, 0, 10000),
		windowStats: &WindowStats{
			Latencies: make([]time.Duration, 0, 1000),
		},
	}
}

func (s *Statistics) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.startTime = time.Now()
	s.isRunning = true
	s.windowStats.WindowStart = time.Now()
}

func (s *Statistics) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.endTime = time.Now()
	s.isRunning = false
}

func (s *Statistics) OnPublish(messageID uint64) {
	atomic.AddUint64(&s.totalPublished, 1)
	s.windowStats.mu.Lock()
	s.windowStats.Published++
	s.windowStats.mu.Unlock()
}

func (s *Statistics) OnReceive(messageID uint64, publishUnixNano, receiveUnixNano int64) {
	latency := time.Duration(receiveUnixNano - publishUnixNano)
	if latency < 0 {
		latency = 0
	}

	atomic.AddUint64(&s.totalReceived, 1)

	s.mu.Lock()
	s.latencies = append(s.latencies, latency)

	if s.hasFirstMessage {
		if messageID <= s.lastReceivedID {
			atomic.AddUint64(&s.totalOutOfOrder, 1)
			s.windowStats.mu.Lock()
			s.windowStats.OutOfOrder++
			s.windowStats.mu.Unlock()
		}
		if messageID > s.lastReceivedID+1 {
			lost := messageID - s.lastReceivedID - 1
			atomic.AddUint64(&s.totalLost, lost)
			s.windowStats.mu.Lock()
			s.windowStats.Lost += lost
			s.windowStats.mu.Unlock()
		}
	} else {
		s.firstMessageID = messageID
		s.hasFirstMessage = true
	}
	s.lastReceivedID = messageID
	s.mu.Unlock()

	s.windowStats.mu.Lock()
	s.windowStats.Received++
	s.windowStats.Latencies = append(s.windowStats.Latencies, latency)
	s.windowStats.mu.Unlock()
}

func (s *Statistics) GetSummary() *StatsSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()

	duration := s.endTime.Sub(s.startTime)
	if s.isRunning {
		duration = time.Since(s.startTime)
	}

	summary := &StatsSummary{
		TotalPublished:  atomic.LoadUint64(&s.totalPublished),
		TotalReceived:   atomic.LoadUint64(&s.totalReceived),
		TotalLost:       atomic.LoadUint64(&s.totalLost),
		TotalOutOfOrder: atomic.LoadUint64(&s.totalOutOfOrder),
		TestDuration:    duration,
	}

	if duration > 0 {
		summary.ReceiveRate = float64(summary.TotalReceived) / duration.Seconds()
		summary.Throughput = float64(summary.TotalPublished) / duration.Seconds()
	}

	if summary.TotalPublished > 0 {
		summary.LossRate = float64(summary.TotalLost) / float64(summary.TotalPublished)
		summary.OutOfOrderRate = float64(summary.TotalOutOfOrder) / float64(summary.TotalReceived)
	}

	if len(s.latencies) > 0 {
		summary.MinLatency = s.latencies[0]
		summary.MaxLatency = s.latencies[0]
		var total time.Duration
		for _, l := range s.latencies {
			total += l
			if l < summary.MinLatency {
				summary.MinLatency = l
			}
			if l > summary.MaxLatency {
				summary.MaxLatency = l
			}
		}
		summary.AvgLatency = total / time.Duration(len(s.latencies))
		summary.P50Latency = percentile(s.latencies, 50)
		summary.P95Latency = percentile(s.latencies, 95)
		summary.P99Latency = percentile(s.latencies, 99)
	}

	return summary
}

func (s *Statistics) GetWindowSummary() *WindowSummary {
	s.windowStats.mu.Lock()
	defer s.windowStats.mu.Unlock()

	duration := time.Since(s.windowStats.WindowStart)
	summary := &WindowSummary{
		Published:      s.windowStats.Published,
		Received:       s.windowStats.Received,
		Lost:           s.windowStats.Lost,
		OutOfOrder:     s.windowStats.OutOfOrder,
		WindowDuration: duration,
	}

	if duration > 0 {
		summary.ReceiveRate = float64(summary.Received) / duration.Seconds()
		summary.Throughput = float64(summary.Published) / duration.Seconds()
	}

	if len(s.windowStats.Latencies) > 0 {
		summary.MinLatency = s.windowStats.Latencies[0]
		summary.MaxLatency = s.windowStats.Latencies[0]
		var total time.Duration
		for _, l := range s.windowStats.Latencies {
			total += l
			if l < summary.MinLatency {
				summary.MinLatency = l
			}
			if l > summary.MaxLatency {
				summary.MaxLatency = l
			}
		}
		summary.AvgLatency = total / time.Duration(len(s.windowStats.Latencies))
	}

	s.windowStats.Published = 0
	s.windowStats.Received = 0
	s.windowStats.Lost = 0
	s.windowStats.OutOfOrder = 0
	s.windowStats.Latencies = s.windowStats.Latencies[:0]
	s.windowStats.WindowStart = time.Now()

	return summary
}

func percentile(latencies []time.Duration, p int) time.Duration {
	if len(latencies) == 0 {
		return 0
	}
	sorted := make([]time.Duration, len(latencies))
	copy(sorted, latencies)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i] < sorted[j]
	})
	index := (len(sorted) * p) / 100
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}
