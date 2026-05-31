package service

import (
	"sync"
	"time"
)

type HeartbeatService struct {
	tracker *TrackerService
	peerStatus map[string]time.Time
	mu         sync.RWMutex
}

func NewHeartbeatService(tracker *TrackerService) *HeartbeatService {
	hs := &HeartbeatService{
		tracker:    tracker,
		peerStatus: make(map[string]time.Time),
	}
	go hs.startCleanupRoutine()
	return hs
}

func (hs *HeartbeatService) ReportHeartbeat(peerID, infoHash string) {
	hs.mu.Lock()
	defer hs.mu.Unlock()
	
	key := peerID + "|" + infoHash
	hs.peerStatus[key] = time.Now()
	
	hs.tracker.UpdatePeerLastSeen(infoHash, peerID)
}

func (hs *HeartbeatService) IsPeerOnline(peerID, infoHash string) bool {
	hs.mu.RLock()
	defer hs.mu.RUnlock()
	
	key := peerID + "|" + infoHash
	lastSeen, exists := hs.peerStatus[key]
	if !exists {
		return false
	}
	
	return time.Since(lastSeen) < 30*time.Second
}

func (hs *HeartbeatService) startCleanupRoutine() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	
	for range ticker.C {
		hs.cleanupOfflinePeers()
		hs.tracker.CleanupOfflinePeers()
	}
}

func (hs *HeartbeatService) cleanupOfflinePeers() {
	hs.mu.Lock()
	defer hs.mu.Unlock()
	
	threshold := time.Now().Add(-2 * time.Minute)
	for key, lastSeen := range hs.peerStatus {
		if lastSeen.Before(threshold) {
			delete(hs.peerStatus, key)
		}
	}
}

func (hs *HeartbeatService) GetOnlinePeerCount(infoHash string) int {
	hs.mu.RLock()
	defer hs.mu.RUnlock()
	
	count := 0
	threshold := time.Now().Add(-30 * time.Second)
	for key, lastSeen := range hs.peerStatus {
		if len(key) > len(infoHash)+1 && key[len(key)-len(infoHash):] == infoHash {
			if lastSeen.After(threshold) {
				count++
			}
		}
	}
	return count
}
