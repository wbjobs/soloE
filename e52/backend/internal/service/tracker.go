package service

import (
	"sync"
	"time"

	"p2p-cdn/internal/model"
)

type TrackerService struct {
	peers map[string]map[string]*model.Peer
	mu    sync.RWMutex
}

func NewTrackerService() *TrackerService {
	return &TrackerService{
		peers: make(map[string]map[string]*model.Peer),
	}
}

func (ts *TrackerService) Announce(infoHash, peerID, ip string, port int, uploaded, downloaded, left int64, event string) []*model.Peer {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if _, exists := ts.peers[infoHash]; !exists {
		ts.peers[infoHash] = make(map[string]*model.Peer)
	}

	isSeeder := left == 0
	peer := &model.Peer{
		ID:         peerID,
		InfoHash:   infoHash,
		IP:         ip,
		Port:       port,
		IsSeeder:   isSeeder,
		LastSeen:   time.Now(),
		Downloaded: downloaded,
		Uploaded:   uploaded,
	}

	ts.peers[infoHash][peerID] = peer

	if event == "stopped" {
		delete(ts.peers[infoHash], peerID)
	}

	return ts.getPeersList(infoHash, peerID)
}

func (ts *TrackerService) getPeersList(infoHash, excludePeerID string) []*model.Peer {
	peers := make([]*model.Peer, 0, len(ts.peers[infoHash])-1)
	for _, peer := range ts.peers[infoHash] {
		if peer.ID != excludePeerID {
			peers = append(peers, peer)
		}
	}
	return peers
}

func (ts *TrackerService) Scrape(infoHashes []string) map[string]struct{ Seeders, Leechers, Complete int } {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	result := make(map[string]struct{ Seeders, Leechers, Complete int })

	for _, infoHash := range infoHashes {
		var seeders, leechers int
		for _, peer := range ts.peers[infoHash] {
			if peer.IsSeeder {
				seeders++
			} else {
				leechers++
			}
		}
		result[infoHash] = struct {
			Seeders  int
			Leechers int
			Complete int
		}{
			Seeders:  seeders,
			Leechers: leechers,
			Complete: seeders,
		}
	}

	return result
}

func (ts *TrackerService) GetOnlinePeers(infoHash string) []*model.Peer {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	peers := make([]*model.Peer, 0)
	threshold := time.Now().Add(-5 * time.Minute)

	for _, peer := range ts.peers[infoHash] {
		if peer.LastSeen.After(threshold) {
			peers = append(peers, peer)
		}
	}

	return peers
}

func (ts *TrackerService) CleanupOfflinePeers() {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	threshold := time.Now().Add(-10 * time.Minute)

	for infoHash, peerMap := range ts.peers {
		for peerID, peer := range peerMap {
			if peer.LastSeen.Before(threshold) {
				delete(peerMap, peerID)
			}
		}
		if len(peerMap) == 0 {
			delete(ts.peers, infoHash)
		}
	}
}

func (ts *TrackerService) UpdatePeerLastSeen(infoHash, peerID string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if peerMap, exists := ts.peers[infoHash]; exists {
		if peer, exists := peerMap[peerID]; exists {
			peer.LastSeen = time.Now()
		}
	}
}
