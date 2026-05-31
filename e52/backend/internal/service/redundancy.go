package service

import (
	"math"
	"sync"
	"time"
)

const (
	MinReplicas           = 3
	HotChunkThreshold     = 10
	ReplicationInterval   = 5 * time.Minute
	MaxConcurrentReplicas = 5
)

type ChunkAvailability struct {
	ChunkHash      string
	ResourceID     string
	PeerIDs        []string
	ReplicaCount   int
	DownloadCount  int
	LastRequested  time.Time
	IsHot          bool
	PriorityScore  float64
}

type ReplicationTask struct {
	ChunkHash    string
	ResourceID   string
	FromPeer     string
	ToPeers      []string
	Status       string
	CreatedAt    time.Time
	CompletedAt  *time.Time
}

type RedundancyService struct {
	resourceStore    *ResourceStore
	dhtService       *DHTService
	availability     map[string]*ChunkAvailability
	tasks            []*ReplicationTask
	mu               sync.RWMutex
	taskChan         chan *ReplicationTask
	stopChan         chan struct{}
}

func NewRedundancyService(resourceStore *ResourceStore, dhtService *DHTService) *RedundancyService {
	rs := &RedundancyService{
		resourceStore: resourceStore,
		dhtService:    dhtService,
		availability:  make(map[string]*ChunkAvailability),
		tasks:         make([]*ReplicationTask, 0),
		taskChan:      make(chan *ReplicationTask, 100),
		stopChan:      make(chan struct{}),
	}

	go rs.startReplicationWorker()
	go rs.startMonitoringRoutine()

	return rs
}

func (rs *RedundancyService) startMonitoringRoutine() {
	ticker := time.NewTicker(ReplicationInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			rs.checkChunkAvailability()
			rs.scheduleReplication()
		case <-rs.stopChan:
			return
		}
	}
}

func (rs *RedundancyService) startReplicationWorker() {
	semaphore := make(chan struct{}, MaxConcurrentReplicas)

	for {
		select {
		case task := <-rs.taskChan:
			semaphore <- struct{}{}
			go func(t *ReplicationTask) {
				defer func() { <-semaphore }()
				rs.executeReplication(t)
			}(task)
		case <-rs.stopChan:
			return
		}
	}
}

func (rs *RedundancyService) RecordChunkDownload(chunkHash, resourceID string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	avail, exists := rs.availability[chunkHash]
	if !exists {
		avail = &ChunkAvailability{
			ChunkHash:     chunkHash,
			ResourceID:    resourceID,
			PeerIDs:       make([]string, 0),
			DownloadCount: 0,
		}
		rs.availability[chunkHash] = avail
	}

	avail.DownloadCount++
	avail.LastRequested = time.Now()
	avail.IsHot = avail.DownloadCount >= HotChunkThreshold
	avail.calculatePriority()
}

func (rs *RedundancyService) RecordChunkHolder(chunkHash, resourceID, peerID string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	avail, exists := rs.availability[chunkHash]
	if !exists {
		avail = &ChunkAvailability{
			ChunkHash:   chunkHash,
			ResourceID:  resourceID,
			PeerIDs:     make([]string, 0),
		}
		rs.availability[chunkHash] = avail
	}

	for _, id := range avail.PeerIDs {
		if id == peerID {
			return
		}
	}

	avail.PeerIDs = append(avail.PeerIDs, peerID)
	avail.ReplicaCount = len(avail.PeerIDs)
	avail.calculatePriority()
}

func (ca *ChunkAvailability) calculatePriority() {
	replicaFactor := math.Max(0, float64(MinReplicas-ca.ReplicaCount))
	hotFactor := 0.0
	if ca.IsHot {
		hotFactor = 2.0
	}
	recencyFactor := 0.0
	if !ca.LastRequested.IsZero() {
		hoursSince := time.Since(ca.LastRequested).Hours()
		recencyFactor = 1.0 / (hoursSince + 1.0)
	}
	ca.PriorityScore = replicaFactor*3.0 + hotFactor*2.0 + recencyFactor*1.0
}

func (rs *RedundancyService) checkChunkAvailability() {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	now := time.Now()
	for _, avail := range rs.availability {
		activePeers := make([]string, 0)
		for _, peerID := range avail.PeerIDs {
			rs.dhtService.mu.RLock()
			peer, exists := rs.dhtService.peers[peerID]
			rs.dhtService.mu.RUnlock()
			if exists && now.Sub(peer.LastSeen) < 30*time.Minute {
				activePeers = append(activePeers, peerID)
			}
		}
		avail.PeerIDs = activePeers
		avail.ReplicaCount = len(activePeers)
		avail.calculatePriority()
	}
}

func (rs *RedundancyService) scheduleReplication() {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	var prioritizedChunks []*ChunkAvailability
	for _, avail := range rs.availability {
		if avail.ReplicaCount < MinReplicas || avail.IsHot {
			prioritizedChunks = append(prioritizedChunks, avail)
		}
	}

	for i := range prioritizedChunks {
		for j := i + 1; j < len(prioritizedChunks); j++ {
			if prioritizedChunks[j].PriorityScore > prioritizedChunks[i].PriorityScore {
				prioritizedChunks[i], prioritizedChunks[j] = prioritizedChunks[j], prioritizedChunks[i]
			}
		}
	}

	for _, avail := range prioritizedChunks {
		if avail.ReplicaCount >= MinReplicas && !avail.IsHot {
			continue
		}

		allNodes := rs.dhtService.GetAllNodes()
		if len(allNodes) == 0 {
			continue
		}

		targetReplicas := MinReplicas
		if avail.IsHot {
			targetReplicas = MinReplicas + 2
		}

		if avail.ReplicaCount >= targetReplicas {
			continue
		}

		needed := targetReplicas - avail.ReplicaCount
		targetPeers := rs.findTargetPeers(avail, allNodes, needed)

		if len(avail.PeerIDs) > 0 && len(targetPeers) > 0 {
			task := &ReplicationTask{
				ChunkHash:  avail.ChunkHash,
				ResourceID: avail.ResourceID,
				FromPeer:   avail.PeerIDs[0],
				ToPeers:    targetPeers,
				Status:     "pending",
				CreatedAt:  time.Now(),
			}

			rs.tasks = append(rs.tasks, task)
			rs.taskChan <- task
		}
	}
}

func (rs *RedundancyService) findTargetPeers(avail *ChunkAvailability, allNodes []*DHTNode, count int) []string {
	targets := make([]string, 0, count)

	for _, node := range allNodes {
		if len(targets) >= count {
			break
		}

		isHolder := false
		for _, holder := range avail.PeerIDs {
			if holder == node.ID {
				isHolder = true
				break
			}
		}

		if !isHolder {
			targets = append(targets, node.ID)
		}
	}

	return targets
}

func (rs *RedundancyService) executeReplication(task *ReplicationTask) {
	task.Status = "executing"

	time.Sleep(100 * time.Millisecond)

	for _, toPeer := range task.ToPeers {
		rs.RecordChunkHolder(task.ChunkHash, task.ResourceID, toPeer)
	}

	now := time.Now()
	task.Status = "completed"
	task.CompletedAt = &now
}

func (rs *RedundancyService) GetChunkAvailability(chunkHash string) (*ChunkAvailability, bool) {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	avail, exists := rs.availability[chunkHash]
	return avail, exists
}

func (rs *RedundancyService) GetAllAvailability() []*ChunkAvailability {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	list := make([]*ChunkAvailability, 0, len(rs.availability))
	for _, avail := range rs.availability {
		list = append(list, avail)
	}
	return list
}

func (rs *RedundancyService) GetReplicationTasks() []*ReplicationTask {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	tasks := make([]*ReplicationTask, len(rs.tasks))
	copy(tasks, rs.tasks)
	return tasks
}

func (rs *RedundancyService) GetResourceChunksAvailability(resourceID string) []*ChunkAvailability {
	rs.mu.RLock()
	defer rs.mu.RUnlock()

	result := make([]*ChunkAvailability, 0)
	for _, avail := range rs.availability {
		if avail.ResourceID == resourceID {
			result = append(result, avail)
		}
	}
	return result
}

func (rs *RedundancyService) Stop() {
	close(rs.stopChan)
}
