package service

import (
	"crypto/sha1"
	"encoding/hex"
	"math/big"
	"sort"
	"sync"
	"time"
)

const (
	K              = 20
	Alpha          = 3
	BucketSize     = 160
	RefreshInterval = 15 * time.Minute
)

type DHTNode struct {
	ID        string
	IP        string
	Port      int
	LastSeen  time.Time
	Distance  *big.Int
}

type KBucket struct {
	Nodes    []*DHTNode
	Lower    *big.Int
	Upper    *big.Int
	LastTouch time.Time
}

type DHTService struct {
	selfID      string
	buckets     []*KBucket
	peers       map[string]*DHTNode
	dataStore   map[string][]string
	mu          sync.RWMutex
	refreshChan chan struct{}
}

func NewDHTService(nodeID string) *DHTService {
	if nodeID == "" {
		nodeID = generateNodeID()
	}

	dht := &DHTService{
		selfID:      nodeID,
		buckets:     make([]*KBucket, BucketSize),
		peers:       make(map[string]*DHTNode),
		dataStore:   make(map[string][]string),
		refreshChan: make(chan struct{}),
	}

	for i := range dht.buckets {
		lower := new(big.Int).Lsh(big.NewInt(1), uint(i))
		upper := new(big.Int).Lsh(big.NewInt(1), uint(i+1))
		dht.buckets[i] = &KBucket{
			Nodes:     make([]*DHTNode, 0, K),
			Lower:     lower,
			Upper:     upper,
			LastTouch: time.Now(),
		}
	}

	go dht.startRefreshRoutine()

	return dht
}

func generateNodeID() string {
	h := sha1.New()
	h.Write([]byte(time.Now().String()))
	return hex.EncodeToString(h.Sum(nil))
}

func xorDistance(a, b string) *big.Int {
	aBytes, _ := hex.DecodeString(a)
	bBytes, _ := hex.DecodeString(b)
	distance := new(big.Int)
	for i := 0; i < len(aBytes) && i < len(bBytes); i++ {
		distance.Lsh(distance, 8)
		distance.Or(distance, big.NewInt(int64(aBytes[i]^bBytes[i])))
	}
	return distance
}

func bucketIndex(distance *big.Int) int {
	for i := 0; i < BucketSize; i++ {
		if distance.Bit(i) == 1 {
			return i
		}
	}
	return 0
}

func (dht *DHTService) AddNode(node *DHTNode) {
	dht.mu.Lock()
	defer dht.mu.Unlock()

	distance := xorDistance(dht.selfID, node.ID)
	idx := bucketIndex(distance)
	bucket := dht.buckets[idx]

	for _, n := range bucket.Nodes {
		if n.ID == node.ID {
			n.LastSeen = time.Now()
			return
		}
	}

	if len(bucket.Nodes) < K {
		node.Distance = distance
		node.LastSeen = time.Now()
		bucket.Nodes = append(bucket.Nodes, node)
		dht.peers[node.ID] = node
	} else {
		oldest := bucket.Nodes[0]
		if time.Since(oldest.LastSeen) > 15*time.Minute {
			copy(bucket.Nodes, bucket.Nodes[1:])
			bucket.Nodes[K-1] = node
			delete(dht.peers, oldest.ID)
			dht.peers[node.ID] = node
		}
	}

	bucket.LastTouch = time.Now()
}

func (dht *DHTService) FindClosest(target string) []*DHTNode {
	dht.mu.RLock()
	defer dht.mu.RUnlock()

	distance := xorDistance(dht.selfID, target)
	idx := bucketIndex(distance)

	var candidates []*DHTNode

	for i := idx; i >= 0 && len(candidates) < K; i-- {
		for _, node := range dht.buckets[i].Nodes {
			if node != nil {
				candidates = append(candidates, node)
			}
		}
	}

	for i := idx + 1; i < BucketSize && len(candidates) < K; i++ {
		for _, node := range dht.buckets[i].Nodes {
			if node != nil {
				candidates = append(candidates, node)
			}
		}
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Distance.Cmp(candidates[j].Distance) < 0
	})

	if len(candidates) > K {
		candidates = candidates[:K]
	}

	return candidates
}

func (dht *DHTService) StoreValue(key string, value string) {
	dht.mu.Lock()
	defer dht.mu.Unlock()

	if _, exists := dht.dataStore[key]; !exists {
		dht.dataStore[key] = make([]string, 0)
	}

	for _, v := range dht.dataStore[key] {
		if v == value {
			return
		}
	}

	dht.dataStore[key] = append(dht.dataStore[key], value)
}

func (dht *DHTService) FindValue(key string) []string {
	dht.mu.RLock()
	defer dht.mu.RUnlock()

	return dht.dataStore[key]
}

func (dht *DHTService) AnnouncePeer(infoHash string, peer *DHTNode) {
	key := "peers:" + infoHash
	dht.StoreValue(key, peer.ID)
}

func (dht *DHTService) GetPeers(infoHash string) []string {
	key := "peers:" + infoHash
	return dht.FindValue(key)
}

func (dht *DHTService) startRefreshRoutine() {
	ticker := time.NewTicker(RefreshInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			dht.refreshBuckets()
		case <-dht.refreshChan:
			return
		}
	}
}

func (dht *DHTService) refreshBuckets() {
	dht.mu.Lock()
	defer dht.mu.Unlock()

	now := time.Now()
	for _, bucket := range dht.buckets {
		if now.Sub(bucket.LastTouch) > RefreshInterval {
			activeNodes := make([]*DHTNode, 0)
			for _, node := range bucket.Nodes {
				if now.Sub(node.LastSeen) < 30*time.Minute {
					activeNodes = append(activeNodes, node)
				} else {
					delete(dht.peers, node.ID)
				}
			}
			bucket.Nodes = activeNodes
			bucket.LastTouch = now
		}
	}
}

func (dht *DHTService) GetAllNodes() []*DHTNode {
	dht.mu.RLock()
	defer dht.mu.RUnlock()

	nodes := make([]*DHTNode, 0, len(dht.peers))
	for _, node := range dht.peers {
		nodes = append(nodes, node)
	}
	return nodes
}

func (dht *DHTService) GetNodeCount() int {
	dht.mu.RLock()
	defer dht.mu.RUnlock()
	return len(dht.peers)
}

func (dht *DHTService) Bootstrap(bootstrapNodes []*DHTNode) {
	for _, node := range bootstrapNodes {
		dht.AddNode(node)
	}

	closest := dht.FindClosest(dht.selfID)
	for _, node := range closest {
		dht.AddNode(node)
	}
}
