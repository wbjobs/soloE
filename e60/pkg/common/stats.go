package common

import (
	"sync"
	"time"
)

type StreamStats struct {
	StreamID    uint64
	BytesSent uint64
	BytesRecv uint64
	CreatedAt time.Time
	UpdatedAt time.Time
	mu        sync.RWMutex
}

func NewStreamStats(streamID uint64) *StreamStats {
	now := time.Now()
	return &StreamStats{
		StreamID:  streamID,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func (s *StreamStats) AddSent(bytes int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.BytesSent += uint64(bytes)
	s.UpdatedAt = time.Now()
}

func (s *StreamStats) AddRecv(bytes int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.BytesRecv += uint64(bytes)
	s.UpdatedAt = time.Now()
}

func (s *StreamStats) GetStats() (sent, recv uint64, duration time.Duration) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.BytesSent, s.BytesRecv, time.Since(s.CreatedAt)
}

type ConnectionStats struct {
	Streams map[uint64]*StreamStats
	mu      sync.RWMutex
}

func NewConnectionStats() *ConnectionStats {
	return &ConnectionStats{
		Streams: make(map[uint64]*StreamStats),
	}
}

func (cs *ConnectionStats) AddStream(streamID uint64) *StreamStats {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	stats := NewStreamStats(streamID)
	cs.Streams[streamID] = stats
	return stats
}

func (cs *ConnectionStats) GetStream(streamID uint64) (*StreamStats, bool) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	stats, exists := cs.Streams[streamID]
	return stats, exists
}

func (cs *ConnectionStats) RemoveStream(streamID uint64) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	delete(cs.Streams, streamID)
}

func (cs *ConnectionStats) GetTotalStats() (totalStreams int, totalSent, totalRecv uint64) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	totalStreams = len(cs.Streams)
	for _, s := range cs.Streams {
		sent, recv, _ := s.GetStats()
		totalSent += sent
		totalRecv += recv
	}
	return totalStreams, totalSent, totalRecv
}
