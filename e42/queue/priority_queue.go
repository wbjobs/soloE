package queue

import (
	"container/heap"
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"distributed-scheduler/models"

	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
)

type PriorityItem struct {
	TaskID    uuid.UUID         `json:"task_id"`
	DAGID     uuid.UUID         `json:"dag_id"`
	Name      string            `json:"name"`
	Type      string            `json:"type"`
	Priority  models.TaskPriority `json:"priority"`
	Endpoint  string            `json:"endpoint"`
	Payload   string            `json:"payload"`
	Retry     int               `json:"retry"`
	EnqueueAt time.Time         `json:"enqueue_at"`
	index     int
}

type PriorityQueue []*PriorityItem

func (pq PriorityQueue) Len() int { return len(pq) }

func (pq PriorityQueue) Less(i, j int) bool {
	if pq[i].Priority.Weight() != pq[j].Priority.Weight() {
		return pq[i].Priority.Weight() > pq[j].Priority.Weight()
	}
	return pq[i].EnqueueAt.Before(pq[j].EnqueueAt)
}

func (pq PriorityQueue) Swap(i, j int) {
	pq[i], pq[j] = pq[j], pq[i]
	pq[i].index = i
	pq[j].index = j
}

func (pq *PriorityQueue) Push(x interface{}) {
	n := len(*pq)
	item := x.(*PriorityItem)
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

type MemoryPriorityQueue struct {
	pq       PriorityQueue
	mu       sync.Mutex
	notEmpty *sync.Cond
	closed   bool
}

func NewMemoryPriorityQueue() *MemoryPriorityQueue {
	mpq := &MemoryPriorityQueue{
		pq: make(PriorityQueue, 0),
	}
	mpq.notEmpty = sync.NewCond(&mpq.mu)
	heap.Init(&mpq.pq)
	return mpq
}

func (mpq *MemoryPriorityQueue) Push(item *PriorityItem) {
	mpq.mu.Lock()
	defer mpq.mu.Unlock()
	
	if mpq.closed {
		return
	}
	
	item.EnqueueAt = time.Now()
	heap.Push(&mpq.pq, item)
	mpq.notEmpty.Signal()
}

func (mpq *MemoryPriorityQueue) Pop(ctx context.Context) (*PriorityItem, error) {
	mpq.mu.Lock()
	defer mpq.mu.Unlock()
	
	for len(mpq.pq) == 0 && !mpq.closed {
		mpq.notEmpty.Wait()
		
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
	}
	
	if mpq.closed && len(mpq.pq) == 0 {
		return nil, fmt.Errorf("queue closed")
	}
	
	item := heap.Pop(&mpq.pq).(*PriorityItem)
	return item, nil
}

func (mpq *MemoryPriorityQueue) TryPop() (*PriorityItem, bool) {
	mpq.mu.Lock()
	defer mpq.mu.Unlock()
	
	if len(mpq.pq) == 0 {
		return nil, false
	}
	
	item := heap.Pop(&mpq.pq).(*PriorityItem)
	return item, true
}

func (mpq *MemoryPriorityQueue) Peek() (*PriorityItem, bool) {
	mpq.mu.Lock()
	defer mpq.mu.Unlock()
	
	if len(mpq.pq) == 0 {
		return nil, false
	}
	
	return mpq.pq[0], true
}

func (mpq *MemoryPriorityQueue) Len() int {
	mpq.mu.Lock()
	defer mpq.mu.Unlock()
	return len(mpq.pq)
}

func (mpq *MemoryPriorityQueue) Close() {
	mpq.mu.Lock()
	defer mpq.mu.Unlock()
	mpq.closed = true
	mpq.notEmpty.Broadcast()
}

type RedisPriorityQueue struct {
	client       *redis.Client
	highQueueKey string
	medQueueKey  string
	lowQueueKey  string
	streamName   string
}

func NewRedisPriorityQueue(addr, password string, db int, prefix string) *RedisPriorityQueue {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})

	return &RedisPriorityQueue{
		client:       client,
		highQueueKey: fmt.Sprintf("%s:priority:high", prefix),
		medQueueKey:  fmt.Sprintf("%s:priority:medium", prefix),
		lowQueueKey:  fmt.Sprintf("%s:priority:low", prefix),
		streamName:   fmt.Sprintf("%s:stream", prefix),
	}
}

func (rpq *RedisPriorityQueue) getQueueKey(priority models.TaskPriority) string {
	switch priority {
	case models.PriorityHigh:
		return rpq.highQueueKey
	case models.PriorityMedium:
		return rpq.medQueueKey
	case models.PriorityLow:
		return rpq.lowQueueKey
	default:
		return rpq.medQueueKey
	}
}

func (rpq *RedisPriorityQueue) Push(ctx context.Context, item *PriorityItem) error {
	data, err := json.Marshal(item)
	if err != nil {
		return fmt.Errorf("failed to marshal item: %w", err)
	}

	key := rpq.getQueueKey(item.Priority)
	_, err = rpq.client.LPush(ctx, key, data).Result()
	return err
}

func (rpq *RedisPriorityQueue) Pop(ctx context.Context) (*PriorityItem, error) {
	keys := []string{rpq.highQueueKey, rpq.medQueueKey, rpq.lowQueueKey}
	
	for _, key := range keys {
		result, err := rpq.client.RPop(ctx, key).Result()
		if err == redis.Nil {
			continue
		}
		if err != nil {
			return nil, err
		}
		
		var item PriorityItem
		if err := json.Unmarshal([]byte(result), &item); err != nil {
			return nil, err
		}
		return &item, nil
	}
	
	return nil, nil
}

func (rpq *RedisPriorityQueue) BPop(ctx context.Context, timeout time.Duration) (*PriorityItem, error) {
	keys := []string{rpq.highQueueKey, rpq.medQueueKey, rpq.lowQueueKey}
	
	result, err := rpq.client.BRPop(ctx, timeout, keys...).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	
	if len(result) < 2 {
		return nil, nil
	}
	
	var item PriorityItem
	if err := json.Unmarshal([]byte(result[1]), &item); err != nil {
		return nil, err
	}
	return &item, nil
}

func (rpq *RedisPriorityQueue) HasHighPriorityTasks(ctx context.Context) (bool, error) {
	count, err := rpq.client.LLen(ctx, rpq.highQueueKey).Result()
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (rpq *RedisPriorityQueue) Len(ctx context.Context) (high, medium, low int64) {
	high, _ = rpq.client.LLen(ctx, rpq.highQueueKey).Result()
	medium, _ = rpq.client.LLen(ctx, rpq.medQueueKey).Result()
	low, _ = rpq.client.LLen(ctx, rpq.lowQueueKey).Result()
	return
}

func (rpq *RedisPriorityQueue) Ping(ctx context.Context) error {
	return rpq.client.Ping(ctx).Err()
}

func (rpq *RedisPriorityQueue) Close() error {
	return rpq.client.Close()
}
