package service

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"p2p-cdn/internal/model"

	"github.com/google/uuid"
)

type ResourceStore struct {
	resources map[string]*model.Resource
	mu        sync.RWMutex
	storagePath string
}

func NewResourceStore() *ResourceStore {
	storagePath := filepath.Join("..", "storage")
	os.MkdirAll(storagePath, 0755)
	return &ResourceStore{
		resources:   make(map[string]*model.Resource),
		storagePath: storagePath,
	}
}

func (rs *ResourceStore) CreateResource(name string, data []byte) (*model.Resource, error) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	chunks := rs.splitIntoChunks(data)
	infoHash := model.GenerateInfoHash(name, chunks)
	magnetLink := model.GenerateMagnetLink(infoHash, name)

	resource := &model.Resource{
		ID:           uuid.New().String(),
		Name:         name,
		Size:         int64(len(data)),
		ChunkCount:   len(chunks),
		ChunkSize:    model.ChunkSize,
		InfoHash:     infoHash,
		MagnetLink:   magnetLink,
		Chunks:       chunks,
		CreatedAt:    time.Now(),
		DownloadCount: 0,
		Seeders:      1,
		Leechers:     0,
		HotScore:     0,
	}

	rs.resources[resource.ID] = resource
	rs.saveChunks(resource.ID, chunks)

	rs.updateHotScore(resource)

	return resource, nil
}

func (rs *ResourceStore) splitIntoChunks(data []byte) []model.Chunk {
	var chunks []model.Chunk
	for i := 0; i < len(data); i += model.ChunkSize {
		end := i + model.ChunkSize
		if end > len(data) {
			end = len(data)
		}
		chunkData := data[i:end]
		
		h := sha1.New()
		h.Write(chunkData)
		hash := hex.EncodeToString(h.Sum(nil))
		
		chunks = append(chunks, model.Chunk{
			Index: len(chunks),
			Hash:  hash,
			Size:  len(chunkData),
			Data:  chunkData,
		})
	}
	return chunks
}

func (rs *ResourceStore) saveChunks(resourceID string, chunks []model.Chunk) error {
	resourcePath := filepath.Join(rs.storagePath, resourceID)
	os.MkdirAll(resourcePath, 0755)

	for _, chunk := range chunks {
		chunkPath := filepath.Join(resourcePath, chunk.Hash)
		if err := os.WriteFile(chunkPath, chunk.Data, 0644); err != nil {
			return err
		}
	}
	return nil
}

func (rs *ResourceStore) GetChunk(resourceID, hash string) ([]byte, error) {
	chunkPath := filepath.Join(rs.storagePath, resourceID, hash)
	return os.ReadFile(chunkPath)
}

func (rs *ResourceStore) GetResource(id string) (*model.Resource, bool) {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	resource, exists := rs.resources[id]
	return resource, exists
}

func (rs *ResourceStore) GetResourceByInfoHash(infoHash string) (*model.Resource, bool) {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	for _, resource := range rs.resources {
		if resource.InfoHash == infoHash {
			return resource, true
		}
	}
	return nil, false
}

func (rs *ResourceStore) ListResources() []*model.Resource {
	rs.mu.RLock()
	defer rs.mu.RUnlock()
	
	list := make([]*model.Resource, 0, len(rs.resources))
	for _, resource := range rs.resources {
		list = append(list, resource)
	}
	
	sort.Slice(list, func(i, j int) bool {
		return list[i].HotScore > list[j].HotScore
	})
	
	return list
}

func (rs *ResourceStore) IncrementDownload(id string) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if resource, exists := rs.resources[id]; exists {
		resource.DownloadCount++
		rs.updateHotScore(resource)
	}
}

func (rs *ResourceStore) UpdateSeederCount(infoHash string, delta int) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	for _, resource := range rs.resources {
		if resource.InfoHash == infoHash {
			resource.Seeders += delta
			if resource.Seeders < 0 {
				resource.Seeders = 0
			}
			rs.updateHotScore(resource)
			break
		}
	}
}

func (rs *ResourceStore) UpdateLeecherCount(infoHash string, delta int) {
	rs.mu.Lock()
	defer rs.mu.Unlock()
	for _, resource := range rs.resources {
		if resource.InfoHash == infoHash {
			resource.Leechers += delta
			if resource.Leechers < 0 {
				resource.Leechers = 0
			}
			rs.updateHotScore(resource)
			break
		}
	}
}

func (rs *ResourceStore) updateHotScore(resource *model.Resource) {
	hoursSinceCreated := time.Since(resource.CreatedAt).Hours()
	score := (float64(resource.DownloadCount)*0.6 + float64(resource.Seeders)*0.3 + float64(resource.Leechers)*0.1) /
		math.Pow(math.Sqrt(hoursSinceCreated+2), 1.5)
	resource.HotScore = score
}

func (rs *ResourceStore) VerifyChunk(chunkData []byte, expectedHash string) bool {
	h := sha1.New()
	h.Write(chunkData)
	actualHash := hex.EncodeToString(h.Sum(nil))
	return actualHash == expectedHash
}

func (rs *ResourceStore) MergeChunks(chunks [][]byte) []byte {
	buffer := bytes.NewBuffer(nil)
	for _, chunk := range chunks {
		buffer.Write(chunk)
	}
	return buffer.Bytes()
}
