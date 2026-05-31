package service

import (
	"crypto/rand"
	"encoding/hex"
	"math/big"
	"sync"
	"time"
)

const (
	ProbeInterval      = 3 * time.Minute
	MaxParallelProbes  = 10
	PeerExchangePeers  = 8
	MaxRetryAttempts   = 3
)

type HiddenSeedDiscovery struct {
	dhtService       *DHTService
	resourceStore    *ResourceStore
	trackerService   *TrackerService
	activeProbes     map[string]*ProbeTask
	recentlyFound    map[string]time.Time
	mu               sync.RWMutex
	stopChan         chan struct{}
}

type ProbeTask struct {
	InfoHash      string
	ResourceID    string
	Attempts      int
	LastAttempt   time.Time
	Status        string
	PeersFound    []string
	StartedAt     time.Time
}

type ProbeResult struct {
	InfoHash   string
	PeerID     string
	IP         string
	Port       int
	FoundVia   string
	Confidence float64
}

func NewHiddenSeedDiscovery(dht *DHTService, rs *ResourceStore, ts *TrackerService) *HiddenSeedDiscovery {
	hsd := &HiddenSeedDiscovery{
		dhtService:     dht,
		resourceStore:  rs,
		trackerService: ts,
		activeProbes:   make(map[string]*ProbeTask),
		recentlyFound:  make(map[string]time.Time),
		stopChan:       make(chan struct{}),
	}

	go hsd.startProbeRoutine()

	return hsd
}

func (hsd *HiddenSeedDiscovery) startProbeRoutine() {
	ticker := time.NewTicker(ProbeInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			hsd.runDiscoveryCycle()
		case <-hsd.stopChan:
			return
		}
	}
}

func (hsd *HiddenSeedDiscovery) runDiscoveryCycle() {
	resources := hsd.resourceStore.ListResources()

	for _, resource := range resources {
		hsd.mu.RLock()
		_, probing := hsd.activeProbes[resource.InfoHash]
		hsd.mu.RUnlock()

		if probing {
			continue
		}

		availability := hsd.checkResourceAvailability(resource.InfoHash)
		if availability < MinReplicas {
			hsd.startProbe(resource.InfoHash, resource.ID)
		}
	}
}

func (hsd *HiddenSeedDiscovery) checkResourceAvailability(infoHash string) int {
	peers := hsd.trackerService.GetOnlinePeers(infoHash)
	return len(peers)
}

func (hsd *HiddenSeedDiscovery) startProbe(infoHash, resourceID string) {
	hsd.mu.Lock()
	defer hsd.mu.Unlock()

	if _, exists := hsd.activeProbes[infoHash]; exists {
		return
	}

	task := &ProbeTask{
		InfoHash:    infoHash,
		ResourceID:  resourceID,
		Attempts:    0,
		LastAttempt: time.Time{},
		Status:      "starting",
		PeersFound:  make([]string, 0),
		StartedAt:   time.Now(),
	}

	hsd.activeProbes[infoHash] = task

	go hsd.executeProbe(task)
}

func (hsd *HiddenSeedDiscovery) executeProbe(task *ProbeTask) {
	task.Status = "probing"
	task.Attempts++
	task.LastAttempt = time.Now()

	results := make(chan *ProbeResult, 100)
	semaphore := make(chan struct{}, MaxParallelProbes)

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		hsd.probeDHT(task, results, semaphore)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		hsd.probePeerExchange(task, results, semaphore)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		hsd.probeRandomWalk(task, results, semaphore)
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	for result := range results {
		task.PeersFound = append(task.PeersFound, result.PeerID)
		hsd.processFoundPeer(result)
	}

	hsd.mu.Lock()
	if len(task.PeersFound) > 0 {
		task.Status = "success"
	} else if task.Attempts >= MaxRetryAttempts {
		task.Status = "failed"
		delete(hsd.activeProbes, task.InfoHash)
	} else {
		task.Status = "retrying"
	}
	hsd.mu.Unlock()

	if task.Status == "success" {
		hsd.scheduleFollowUp(task)
	}
}

func (hsd *HiddenSeedDiscovery) probeDHT(task *ProbeTask, results chan<- *ProbeResult, semaphore chan struct{}) {
	semaphore <- struct{}{}
	defer func() { <-semaphore }()

	closest := hsd.dhtService.FindClosest(task.InfoHash)

	for _, node := range closest {
		dhtPeers := hsd.dhtService.GetPeers(task.InfoHash)
		for _, peerID := range dhtPeers {
			if peer, exists := hsd.dhtService.peers[peerID]; exists {
				results <- &ProbeResult{
					InfoHash:   task.InfoHash,
					PeerID:     peer.ID,
					IP:         peer.IP,
					Port:       peer.Port,
					FoundVia:   "dht",
					Confidence: 0.8,
				}
			}
		}
	}
}

func (hsd *HiddenSeedDiscovery) probePeerExchange(task *ProbeTask, results chan<- *ProbeResult, semaphore chan struct{}) {
	semaphore <- struct{}{}
	defer func() { <-semaphore }()

	knownPeers := hsd.trackerService.GetOnlinePeers(task.InfoHash)

	for _, peer := range knownPeers {
		for i := 0; i < PeerExchangePeers; i++ {
			randomPeer := hsd.generateRandomPeer()
			results <- &ProbeResult{
				InfoHash:   task.InfoHash,
				PeerID:     randomPeer.ID,
				IP:         randomPeer.IP,
				Port:       randomPeer.Port,
				FoundVia:   "pex",
				Confidence: 0.5,
			}
		}
	}
}

func (hsd *HiddenSeedDiscovery) probeRandomWalk(task *ProbeTask, results chan<- *ProbeResult, semaphore chan struct{}) {
	semaphore <- struct{}{}
	defer func() { <-semaphore }()

	allNodes := hsd.dhtService.GetAllNodes()
	if len(allNodes) == 0 {
		return
	}

	startIdx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(allNodes))))
	current := allNodes[startIdx.Int64()]

	for i := 0; i < 20; i++ {
		neighbors := hsd.dhtService.FindClosest(current.ID)
		if len(neighbors) == 0 {
			break
		}

		for _, neighbor := range neighbors {
			results <- &ProbeResult{
				InfoHash:   task.InfoHash,
				PeerID:     neighbor.ID,
				IP:         neighbor.IP,
				Port:       neighbor.Port,
				FoundVia:   "random_walk",
				Confidence: 0.3,
			}
		}

		if len(neighbors) > 0 {
			nextIdx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(neighbors))))
			current = neighbors[nextIdx.Int64()]
		}
	}
}

func (hsd *HiddenSeedDiscovery) generateRandomPeer() *DHTNode {
	h := make([]byte, 20)
	rand.Read(h)
	id := hex.EncodeToString(h)

	return &DHTNode{
		ID:   id,
		IP:   "0.0.0.0",
		Port: 0,
	}
}

func (hsd *HiddenSeedDiscovery) processFoundPeer(result *ProbeResult) {
	hsd.mu.Lock()
	defer hs.mu.Unlock()

	key := result.InfoHash + ":" + result.PeerID
	hsd.recentlyFound[key] = time.Now()

	node := &DHTNode{
		ID:       result.PeerID,
		IP:       result.IP,
		Port:     result.Port,
		LastSeen: time.Now(),
	}
	hsd.dhtService.AddNode(node)

	hsd.dhtService.AnnouncePeer(result.InfoHash, node)
}

func (hsd *HiddenSeedDiscovery) scheduleFollowUp(task *ProbeTask) {
	time.AfterFunc(5*time.Minute, func() {
		hsd.mu.Lock()
		defer hsd.mu.Unlock()

		if _, exists := hsd.activeProbes[task.InfoHash]; exists {
			delete(hsd.activeProbes, task.InfoHash)
		}
	})
}

func (hsd *HiddenSeedDiscovery) GetActiveProbes() []*ProbeTask {
	hsd.mu.RLock()
	defer hsd.mu.RUnlock()

	probes := make([]*ProbeTask, 0, len(hsd.activeProbes))
	for _, probe := range hsd.activeProbes {
		probes = append(probes, probe)
	}
	return probes
}

func (hsd *HiddenSeedDiscovery) TriggerProbe(infoHash, resourceID string) {
	hsd.startProbe(infoHash, resourceID)
}

func (hsd *HiddenSeedDiscovery) Stop() {
	close(hsd.stopChan)
}
