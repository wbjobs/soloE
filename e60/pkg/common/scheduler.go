package common

import (
	"container/heap"
	"sync"
	"time"
)

type Priority int

const (
	PriorityCritical Priority = 0 
	PriorityHigh     Priority = 1 
	PriorityNormal   Priority = 2 
	PriorityLow      Priority = 3 
)

type ScheduledPacket struct {
	StreamID   uint64
	Priority   Priority
	Data       []byte
	CreateTime time.Time
	Deadline   time.Time
	index      int
}

type PriorityQueue []*ScheduledPacket

func (pq PriorityQueue) Len() int { return len(pq) }

func (pq PriorityQueue) Less(i, j int) bool {
	if pq[i].Priority != pq[j].Priority {
		return pq[i].Priority < pq[j].Priority
	}

	ageI := time.Since(pq[i].CreateTime)
	ageJ := time.Since(pq[j].CreateTime)
	return ageI > ageJ
}

func (pq PriorityQueue) Swap(i, j int) {
	pq[i], pq[j] = pq[j], pq[i]
	pq[i].index = i
	pq[j].index = j
}

func (pq *PriorityQueue) Push(x interface{}) {
	n := len(*pq)
	item := x.(*ScheduledPacket)
	item.index = n
	*pq = append(*pq, item)
}

func (pq *PriorityQueue) Pop() interface{} {
	old := *pq
	n := len(old)
	item := old[n-1]
	old[n-1] = nil
	item.index = -1
	*pq = old[0 : n-1]
	return item
}

type StreamScheduler struct {
	mu sync.Mutex

	pq       PriorityQueue
	cond     *sync.Cond

	maxQueueSize int
	packetCount  map[Priority]int

	streamWeights map[uint64]float64
	streamCredits map[uint64]float64

	lastScheduleTime time.Time
	closed           bool
}

func NewStreamScheduler(maxQueueSize int) *StreamScheduler {
	s := &StreamScheduler{
		pq:             make(PriorityQueue, 0),
		maxQueueSize:   maxQueueSize,
		packetCount:    make(map[Priority]int),
		streamWeights:  make(map[uint64]float64),
		streamCredits:  make(map[uint64]float64),
		lastScheduleTime: time.Now(),
	}
	s.cond = sync.NewCond(&s.mu)
	heap.Init(&s.pq)
	return s
}

func (s *StreamScheduler) SetStreamWeight(streamID uint64, weight float64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if weight < 0.1 {
		weight = 0.1
	}
	if weight > 10.0 {
		weight = 10.0
	}
	s.streamWeights[streamID] = weight
}

func (s *StreamScheduler) Enqueue(packet *ScheduledPacket) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return false
	}

	total := 0
	for _, count := range s.packetCount {
		total += count
	}
	if total >= s.maxQueueSize {
		s.dropLowPriorityPackets()
		total = 0
		for _, count := range s.packetCount {
			total += count
		}
		if total >= s.maxQueueSize {
			return false
		}
	}

	packet.CreateTime = time.Now()
	heap.Push(&s.pq, packet)
	s.packetCount[packet.Priority]++
	s.cond.Signal()

	return true
}

func (s *StreamScheduler) Dequeue(timeout time.Duration) *ScheduledPacket {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil
	}

	if s.pq.Len() == 0 {
		if timeout <= 0 {
			return nil
		}
		done := make(chan struct{})
		go func() {
			time.Sleep(timeout)
			s.mu.Lock()
			s.cond.Broadcast()
			s.mu.Unlock()
			close(done)
		}()
		s.cond.Wait()
		select {
		case <-done:
		default:
		}
		if s.pq.Len() == 0 {
			return nil
		}
	}

	now := time.Now()
	for s.pq.Len() > 0 {
		item := s.pq[0]
		if !item.Deadline.IsZero() && now.After(item.Deadline) {
			heap.Pop(&s.pq)
			s.packetCount[item.Priority]--
			continue
		}

		weight := s.streamWeights[item.StreamID]
		if weight == 0 {
			weight = 1.0
		}

		credit := s.streamCredits[item.StreamID]
		elapsed := now.Sub(s.lastScheduleTime).Seconds()
		credit += elapsed * weight

		if credit >= 1.0 || s.pq.Len() == 1 {
			heap.Pop(&s.pq)
			s.packetCount[item.Priority]--
			s.streamCredits[item.StreamID] = credit - 1.0
			if s.streamCredits[item.StreamID] < 0 {
				s.streamCredits[item.StreamID] = 0
			}
			s.lastScheduleTime = now
			return item
		}

		break
	}

	return nil
}

func (s *StreamScheduler) dropLowPriorityPackets() {
	dropped := 0
	for i := s.pq.Len() - 1; i >= 0; i-- {
		if s.pq[i].Priority >= PriorityLow {
			heap.Remove(&s.pq, i)
			s.packetCount[s.pq[i].Priority]--
			dropped++
		}
	}

	if dropped == 0 && s.pq.Len() > 0 {
		for i := s.pq.Len() - 1; i >= 0 && s.pq.Len() > s.maxQueueSize/2; i-- {
			if s.pq[i].Priority >= PriorityNormal {
				heap.Remove(&s.pq, i)
				s.packetCount[s.pq[i].Priority]--
			}
		}
	}
}

func (s *StreamScheduler) GetQueueSize() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pq.Len()
}

func (s *StreamScheduler) GetPacketCount(priority Priority) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.packetCount[priority]
}

func (s *StreamScheduler) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	s.cond.Broadcast()
}
