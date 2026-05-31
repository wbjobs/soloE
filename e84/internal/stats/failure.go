package stats

import (
	"sync"
	"sync/atomic"
	"time"
)

type FailureInjectionStats struct {
	mu sync.RWMutex

	failureCount        uint64
	lastFailureTime     time.Time
	lastRecoveryTime    time.Time
	totalDowntime       time.Duration
	isInFailure         bool

	reconnectAttempts   uint64
	successfulReconnects uint64
	failedReconnects    uint64

	messagesDuringFailure uint64
	messagesAfterRecovery uint64
	duplicateMessages    uint64
	unconfirmedMessages  uint64

	failureEvents       []FailureEvent
}

type FailureEvent struct {
	ID              uint64
	FailureTime     time.Time
	RecoveryTime    time.Time
	Duration        time.Duration
	ReconnectTime   time.Duration
	MessagesLost    uint64
	MessagesDup     uint64
	Unconfirmed     uint64
}

type FailureSummary struct {
	TotalFailures       uint64
	TotalDowntime       time.Duration
	AvgDowntime         time.Duration
	TotalReconnects     uint64
	SuccessfulReconnects uint64
	FailedReconnects    uint64
	ReconnectSuccessRate float64
	MessagesDuringFailure uint64
	MessagesAfterRecovery uint64
	DuplicateMessages    uint64
	UnconfirmedMessages  uint64
	LastFailure         *FailureEvent
	IsInFailure         bool
}

func NewFailureInjectionStats() *FailureInjectionStats {
	return &FailureInjectionStats{
		failureEvents: make([]FailureEvent, 0, 10),
	}
}

func (f *FailureInjectionStats) RecordFailure() {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.failureCount++
	f.lastFailureTime = time.Now()
	f.isInFailure = true

	f.failureEvents = append(f.failureEvents, FailureEvent{
		ID:          f.failureCount,
		FailureTime: f.lastFailureTime,
	})
}

func (f *FailureInjectionStats) RecordRecovery(reconnectTime time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if !f.isInFailure {
		return
	}

	f.lastRecoveryTime = time.Now()
	f.isInFailure = false

	downtime := f.lastRecoveryTime.Sub(f.lastFailureTime)
	f.totalDowntime += downtime

	if len(f.failureEvents) > 0 {
		idx := len(f.failureEvents) - 1
		f.failureEvents[idx].RecoveryTime = f.lastRecoveryTime
		f.failureEvents[idx].Duration = downtime
		f.failureEvents[idx].ReconnectTime = reconnectTime
	}
}

func (f *FailureInjectionStats) IncrementReconnectAttempt(success bool) {
	atomic.AddUint64(&f.reconnectAttempts, 1)
	if success {
		atomic.AddUint64(&f.successfulReconnects, 1)
	} else {
		atomic.AddUint64(&f.failedReconnects, 1)
	}
}

func (f *FailureInjectionStats) IncrementMessagesDuringFailure() {
	atomic.AddUint64(&f.messagesDuringFailure, 1)
}

func (f *FailureInjectionStats) IncrementMessagesAfterRecovery() {
	atomic.AddUint64(&f.messagesAfterRecovery, 1)
}

func (f *FailureInjectionStats) IncrementDuplicateMessages(count uint64) {
	atomic.AddUint64(&f.duplicateMessages, count)
	if len(f.failureEvents) > 0 {
		f.mu.Lock()
		idx := len(f.failureEvents) - 1
		f.failureEvents[idx].MessagesDup += count
		f.mu.Unlock()
	}
}

func (f *FailureInjectionStats) IncrementUnconfirmedMessages(count uint64) {
	atomic.AddUint64(&f.unconfirmedMessages, count)
	if len(f.failureEvents) > 0 {
		f.mu.Lock()
		idx := len(f.failureEvents) - 1
		f.failureEvents[idx].Unconfirmed += count
		f.mu.Unlock()
	}
}

func (f *FailureInjectionStats) SetMessagesLost(count uint64) {
	if len(f.failureEvents) > 0 {
		f.mu.Lock()
		idx := len(f.failureEvents) - 1
		f.failureEvents[idx].MessagesLost = count
		f.mu.Unlock()
	}
}

func (f *FailureInjectionStats) IsInFailure() bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.isInFailure
}

func (f *FailureInjectionStats) GetSummary() *FailureSummary {
	f.mu.RLock()
	defer f.mu.RUnlock()

	summary := &FailureSummary{
		TotalFailures:        f.failureCount,
		TotalDowntime:        f.totalDowntime,
		TotalReconnects:      atomic.LoadUint64(&f.reconnectAttempts),
		SuccessfulReconnects: atomic.LoadUint64(&f.successfulReconnects),
		FailedReconnects:     atomic.LoadUint64(&f.failedReconnects),
		MessagesDuringFailure: atomic.LoadUint64(&f.messagesDuringFailure),
		MessagesAfterRecovery: atomic.LoadUint64(&f.messagesAfterRecovery),
		DuplicateMessages:     atomic.LoadUint64(&f.duplicateMessages),
		UnconfirmedMessages:   atomic.LoadUint64(&f.unconfirmedMessages),
		IsInFailure:          f.isInFailure,
	}

	if f.failureCount > 0 {
		summary.AvgDowntime = f.totalDowntime / time.Duration(f.failureCount)
	}

	if summary.TotalReconnects > 0 {
		summary.ReconnectSuccessRate = float64(summary.SuccessfulReconnects) / float64(summary.TotalReconnects)
	}

	if len(f.failureEvents) > 0 {
		lastEvent := f.failureEvents[len(f.failureEvents)-1]
		summary.LastFailure = &lastEvent
	}

	return summary
}

func (f *FailureInjectionStats) GetFailureEvents() []FailureEvent {
	f.mu.RLock()
	defer f.mu.RUnlock()
	events := make([]FailureEvent, len(f.failureEvents))
	copy(events, f.failureEvents)
	return events
}

func (f *FailureInjectionStats) GetLastFailureTime() time.Time {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.lastFailureTime
}
