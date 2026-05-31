package tester

import (
	"crypto/tls"
	"sync"
	"sync/atomic"
	"time"
)

type SessionCache struct {
	cache    map[string]*tls.ClientSessionState
	mu       sync.RWMutex
	maxSize  int
	ttl      time.Duration
}

type SessionStats struct {
	TotalConnections  uint64
	ReusedSessions    uint64
	NewSessions       uint64
}

func NewSessionCache(maxSize int, ttl time.Duration) *SessionCache {
	sc := &SessionCache{
		cache:   make(map[string]*tls.ClientSessionState),
		maxSize: maxSize,
		ttl:     ttl,
	}
	go sc.cleanupLoop()
	return sc
}

func (sc *SessionCache) Get(key string) (*tls.ClientSessionState, bool) {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	session, ok := sc.cache[key]
	return session, ok
}

func (sc *SessionCache) Put(key string, session *tls.ClientSessionState) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	
	if len(sc.cache) >= sc.maxSize {
		sc.evictOldest()
	}
	sc.cache[key] = session
}

func (sc *SessionCache) evictOldest() {
	for k := range sc.cache {
		delete(sc.cache, k)
		break
	}
}

func (sc *SessionCache) cleanupLoop() {
	ticker := time.NewTicker(sc.ttl / 2)
	defer ticker.Stop()
	for range ticker.C {
		sc.mu.Lock()
		sc.cache = make(map[string]*tls.ClientSessionState)
		sc.mu.Unlock()
	}
}

func (sc *SessionCache) Size() int {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	return len(sc.cache)
}

type SessionTracker struct {
	cache        *SessionCache
	stats        SessionStats
	keyGenerator func() string
}

func NewSessionTracker() *SessionTracker {
	return &SessionTracker{
		cache: NewSessionCache(10000, 1*time.Hour),
		keyGenerator: func() string {
			return "global"
		},
	}
}

func (st *SessionTracker) GetSessionCache() tls.ClientSessionCache {
	return &tlsSessionCacheAdapter{tracker: st}
}

func (st *SessionTracker) GetStats() SessionStats {
	return SessionStats{
		TotalConnections: atomic.LoadUint64(&st.stats.TotalConnections),
		ReusedSessions:   atomic.LoadUint64(&st.stats.ReusedSessions),
		NewSessions:      atomic.LoadUint64(&st.stats.NewSessions),
	}
}

func (st *SessionTracker) GetReuseRate() float64 {
	total := atomic.LoadUint64(&st.stats.TotalConnections)
	reused := atomic.LoadUint64(&st.stats.ReusedSessions)
	if total == 0 {
		return 0
	}
	return float64(reused) / float64(total) * 100
}

func (st *SessionTracker) ResetStats() {
	atomic.StoreUint64(&st.stats.TotalConnections, 0)
	atomic.StoreUint64(&st.stats.ReusedSessions, 0)
	atomic.StoreUint64(&st.stats.NewSessions, 0)
}

type tlsSessionCacheAdapter struct {
	tracker *SessionTracker
}

func (a *tlsSessionCacheAdapter) Get(key string) (*tls.ClientSessionState, bool) {
	atomic.AddUint64(&a.tracker.stats.TotalConnections, 1)
	session, ok := a.tracker.cache.Get(key)
	if ok {
		atomic.AddUint64(&a.tracker.stats.ReusedSessions, 1)
	}
	return session, ok
}

func (a *tlsSessionCacheAdapter) Put(key string, cs *tls.ClientSessionState) {
	atomic.AddUint64(&a.tracker.stats.NewSessions, 1)
	a.tracker.cache.Put(key, cs)
}
