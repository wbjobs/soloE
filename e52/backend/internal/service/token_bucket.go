package service

import (
	"sync"
	"time"
)

type TokenBucket struct {
	rate           int64 // 令牌生成速率 (bytes/second)
	capacity       int64 // 桶的容量 (bytes)
	tokens         int64 // 当前令牌数
	lastRefillTime time.Time
	mu             sync.Mutex
	enabled        bool
}

func NewTokenBucket(rateBytesPerSec int64, capacityBytes int64) *TokenBucket {
	return &TokenBucket{
		rate:           rateBytesPerSec,
		capacity:       capacityBytes,
		tokens:         capacityBytes,
		lastRefillTime: time.Now(),
		enabled:        true,
	}
}

func (tb *TokenBucket) refill() {
	now := time.Now()
	elapsed := now.Sub(tb.lastRefillTime).Seconds()
	newTokens := int64(elapsed * float64(tb.rate))

	if newTokens > 0 {
		tb.tokens = min(tb.tokens+newTokens, tb.capacity)
		tb.lastRefillTime = now
	}
}

func (tb *TokenBucket) TryConsume(bytes int64) bool {
	if !tb.enabled {
		return true
	}

	tb.mu.Lock()
	defer tb.mu.Unlock()

	tb.refill()

	if tb.tokens >= bytes {
		tb.tokens -= bytes
		return true
	}
	return false
}

func (tb *TokenBucket) Consume(bytes int64, maxWait time.Duration) bool {
	if !tb.enabled {
		return true
	}

	deadline := time.Now().Add(maxWait)
	for time.Now().Before(deadline) {
		if tb.TryConsume(bytes) {
			return true
		}
		waitTime := time.Duration(float64(bytes-tb.tokens)/float64(tb.rate)) * time.Second
		if waitTime > 100*time.Millisecond {
			waitTime = 100 * time.Millisecond
		}
		time.Sleep(waitTime)
	}
	return false
}

func (tb *TokenBucket) SetRate(rateBytesPerSec int64) {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	tb.rate = rateBytesPerSec
	tb.refill()
}

func (tb *TokenBucket) SetCapacity(capacityBytes int64) {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	tb.capacity = capacityBytes
	if tb.tokens > tb.capacity {
		tb.tokens = tb.capacity
	}
}

func (tb *TokenBucket) SetEnabled(enabled bool) {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	tb.enabled = enabled
}

func (tb *TokenBucket) GetRate() int64 {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	return tb.rate
}

func (tb *TokenBucket) GetTokens() int64 {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	tb.refill()
	return tb.tokens
}

func (tb *TokenBucket) GetCapacity() int64 {
	tb.mu.Lock()
	defer tb.mu.Unlock()
	return tb.capacity
}

func min(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

type BandwidthController struct {
	uploadLimiter   *TokenBucket
	downloadLimiter *TokenBucket
	uploadStats     *TransferStats
	downloadStats   *TransferStats
	mu              sync.RWMutex
}

type TransferStats struct {
	TotalBytes   int64
	BytesInLast  int64
	LastUpdate   time.Time
	History      []SpeedSample
}

type SpeedSample struct {
	Timestamp time.Time
	Speed     int64
}

func NewBandwidthController() *BandwidthController {
	bc := &BandwidthController{
		uploadLimiter:   NewTokenBucket(10*1024*1024, 5*1024*1024), // 默认 10MB/s, 5MB burst
		downloadLimiter: NewTokenBucket(20*1024*1024, 10*1024*1024), // 默认 20MB/s, 10MB burst
		uploadStats:     &TransferStats{History: make([]SpeedSample, 0, 60)},
		downloadStats:   &TransferStats{History: make([]SpeedSample, 0, 60)},
	}
	go bc.startStatsUpdater()
	return bc
}

func (bc *BandwidthController) startStatsUpdater() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		bc.mu.Lock()
		now := time.Now()

		bc.uploadStats.History = append(bc.uploadStats.History, SpeedSample{
			Timestamp: now,
			Speed:     bc.uploadStats.BytesInLast,
		})
		if len(bc.uploadStats.History) > 60 {
			bc.uploadStats.History = bc.uploadStats.History[1:]
		}
		bc.uploadStats.BytesInLast = 0

		bc.downloadStats.History = append(bc.downloadStats.History, SpeedSample{
			Timestamp: now,
			Speed:     bc.downloadStats.BytesInLast,
		})
		if len(bc.downloadStats.History) > 60 {
			bc.downloadStats.History = bc.downloadStats.History[1:]
		}
		bc.downloadStats.BytesInLast = 0

		bc.mu.Unlock()
	}
}

func (bc *BandwidthController) TryUpload(bytes int64) bool {
	success := bc.uploadLimiter.TryConsume(bytes)
	if success {
		bc.mu.Lock()
		bc.uploadStats.TotalBytes += bytes
		bc.uploadStats.BytesInLast += bytes
		bc.mu.Unlock()
	}
	return success
}

func (bc *BandwidthController) TryDownload(bytes int64) bool {
	success := bc.downloadLimiter.TryConsume(bytes)
	if success {
		bc.mu.Lock()
		bc.downloadStats.TotalBytes += bytes
		bc.downloadStats.BytesInLast += bytes
		bc.mu.Unlock()
	}
	return success
}

func (bc *BandwidthController) SetUploadRate(rateBytesPerSec int64) {
	bc.uploadLimiter.SetRate(rateBytesPerSec)
}

func (bc *BandwidthController) SetDownloadRate(rateBytesPerSec int64) {
	bc.downloadLimiter.SetRate(rateBytesPerSec)
}

func (bc *BandwidthController) SetBandwidthFriendly(enabled bool) {
	bc.uploadLimiter.SetEnabled(enabled)
	bc.downloadLimiter.SetEnabled(enabled)
}

func (bc *BandwidthController) GetUploadRate() int64 {
	return bc.uploadLimiter.GetRate()
}

func (bc *BandwidthController) GetDownloadRate() int64 {
	return bc.downloadLimiter.GetRate()
}

func (bc *BandwidthController) GetCurrentUploadSpeed() int64 {
	bc.mu.RLock()
	defer bc.mu.RUnlock()
	if len(bc.uploadStats.History) == 0 {
		return 0
	}
	return bc.uploadStats.History[len(bc.uploadStats.History)-1].Speed
}

func (bc *BandwidthController) GetCurrentDownloadSpeed() int64 {
	bc.mu.RLock()
	defer bc.mu.RUnlock()
	if len(bc.downloadStats.History) == 0 {
		return 0
	}
	return bc.downloadStats.History[len(bc.downloadStats.History)-1].Speed
}

func (bc *BandwidthController) GetUploadHistory() []SpeedSample {
	bc.mu.RLock()
	defer bc.mu.RUnlock()
	history := make([]SpeedSample, len(bc.uploadStats.History))
	copy(history, bc.uploadStats.History)
	return history
}

func (bc *BandwidthController) GetDownloadHistory() []SpeedSample {
	bc.mu.RLock()
	defer bc.mu.RUnlock()
	history := make([]SpeedSample, len(bc.downloadStats.History))
	copy(history, bc.downloadStats.History)
	return history
}

func (bc *BandwidthController) GetTotalUploaded() int64 {
	bc.mu.RLock()
	defer bc.mu.RUnlock()
	return bc.uploadStats.TotalBytes
}

func (bc *BandwidthController) GetTotalDownloaded() int64 {
	bc.mu.RLock()
	defer bc.mu.RUnlock()
	return bc.downloadStats.TotalBytes
}

type BandwidthConfig struct {
	Enabled         bool  `json:"enabled"`
	UploadLimitKBps int64 `json:"uploadLimitKBps"`
	DownloadLimitKBps int64 `json:"downloadLimitKBps"`
}

func (bc *BandwidthController) GetConfig() BandwidthConfig {
	return BandwidthConfig{
		Enabled:          true,
		UploadLimitKBps:  bc.GetUploadRate() / 1024,
		DownloadLimitKBps: bc.GetDownloadRate() / 1024,
	}
}

func (bc *BandwidthController) ApplyConfig(config BandwidthConfig) {
	bc.SetBandwidthFriendly(config.Enabled)
	bc.SetUploadRate(config.UploadLimitKBps * 1024)
	bc.SetDownloadRate(config.DownloadLimitKBps * 1024)
}
