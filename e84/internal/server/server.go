package server

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"mqtt-load-tester/internal/mqtt"
	"mqtt-load-tester/internal/stats"
	"mqtt-load-tester/internal/timeseries"
)

type HTTPServer struct {
	engine      *gin.Engine
	clientMgr   *mqtt.ClientManager
	stats       *stats.Statistics
	timeSeries  *timeseries.TimeSeriesStore
	server      *http.Server
}

type AddClientsRequest struct {
	Count int `json:"count" binding:"required,min=1"`
}

type RemoveClientsRequest struct {
	Count int `json:"count" binding:"required,min=1"`
}

type SetPublishRateRequest struct {
	Rate int `json:"rate" binding:"required,min=1"`
}

type StatusResponse struct {
	ClientCount    int     `json:"client_count"`
	PublishRate    int     `json:"publish_rate"`
	TotalPublished uint64  `json:"total_published"`
	TotalReceived  uint64  `json:"total_received"`
	TotalLost      uint64  `json:"total_lost"`
	OutOfOrder     uint64  `json:"out_of_order"`
	AvgLatencyMs   float64 `json:"avg_latency_ms"`
	Throughput     float64 `json:"throughput_msg_sec"`
}

type MemoryResponse struct {
	AllocMB      float64 `json:"alloc_mb"`
	TotalAllocMB float64 `json:"total_alloc_mb"`
	SysMB        float64 `json:"sys_mb"`
	NumGC        uint32  `json:"num_gc"`
}

func NewHTTPServer(clientMgr *mqtt.ClientManager, stats *stats.Statistics, timeSeries *timeseries.TimeSeriesStore) *HTTPServer {
	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	engine.Use(gin.Recovery())

	s := &HTTPServer{
		engine:     engine,
		clientMgr:  clientMgr,
		stats:      stats,
		timeSeries: timeSeries,
	}

	s.setupRoutes()
	return s
}

func (s *HTTPServer) setupRoutes() {
	api := s.engine.Group("/api/v1")
	{
		api.GET("/status", s.getStatus)
		api.GET("/stats", s.getStats)
		api.GET("/memory", s.getMemory)
		api.GET("/timeseries", s.getTimeSeries)
		api.GET("/failure", s.getFailureStats)
		api.GET("/failure/events", s.getFailureEvents)
		api.POST("/failure/inject", s.injectFailure)
		api.POST("/clients/add", s.addClients)
		api.POST("/clients/remove", s.removeClients)
		api.POST("/publish-rate", s.setPublishRate)
	}

	s.engine.StaticFile("/", "./web/index.html")
	s.engine.Static("/static", "./web/static")

	s.engine.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
}

func (s *HTTPServer) getStatus(c *gin.Context) {
	summary := s.stats.GetSummary()
	c.JSON(http.StatusOK, StatusResponse{
		ClientCount:    s.clientMgr.GetClientCount(),
		PublishRate:    s.clientMgr.GetPublishRate(),
		TotalPublished: summary.TotalPublished,
		TotalReceived:  summary.TotalReceived,
		TotalLost:      summary.TotalLost,
		OutOfOrder:     summary.TotalOutOfOrder,
		AvgLatencyMs:   float64(summary.AvgLatency) / float64(time.Millisecond),
		Throughput:     summary.Throughput,
	})
}

func (s *HTTPServer) getStats(c *gin.Context) {
	summary := s.stats.GetSummary()
	c.JSON(http.StatusOK, gin.H{
		"total_published":   summary.TotalPublished,
		"total_received":    summary.TotalReceived,
		"total_lost":        summary.TotalLost,
		"total_out_of_order": summary.TotalOutOfOrder,
		"receive_rate":      summary.ReceiveRate,
		"throughput":        summary.Throughput,
		"loss_rate_percent": summary.LossRate * 100,
		"out_of_order_rate_percent": summary.OutOfOrderRate * 100,
		"avg_latency_ms":    float64(summary.AvgLatency) / float64(time.Millisecond),
		"min_latency_ms":    float64(summary.MinLatency) / float64(time.Millisecond),
		"max_latency_ms":    float64(summary.MaxLatency) / float64(time.Millisecond),
		"p50_latency_ms":    float64(summary.P50Latency) / float64(time.Millisecond),
		"p95_latency_ms":    float64(summary.P95Latency) / float64(time.Millisecond),
		"p99_latency_ms":    float64(summary.P99Latency) / float64(time.Millisecond),
		"test_duration_seconds": summary.TestDuration.Seconds(),
	})
}

func (s *HTTPServer) addClients(c *gin.Context) {
	var req AddClientsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.clientMgr.AddClients(req.Count); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      fmt.Sprintf("Added %d clients", req.Count),
		"total_clients": s.clientMgr.GetClientCount(),
	})
}

func (s *HTTPServer) removeClients(c *gin.Context) {
	var req RemoveClientsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.clientMgr.RemoveClients(req.Count); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      fmt.Sprintf("Removed %d clients", req.Count),
		"total_clients": s.clientMgr.GetClientCount(),
	})
}

func (s *HTTPServer) setPublishRate(c *gin.Context) {
	var req SetPublishRateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	s.clientMgr.SetPublishRate(req.Rate)

	c.JSON(http.StatusOK, gin.H{
		"message":       fmt.Sprintf("Publish rate set to %d msg/s", req.Rate),
		"publish_rate":  req.Rate,
	})
}

func (s *HTTPServer) getMemory(c *gin.Context) {
	ms := s.clientMgr.GetMemoryStats()
	c.JSON(http.StatusOK, MemoryResponse{
		AllocMB:      float64(ms.Alloc) / 1024 / 1024,
		TotalAllocMB: float64(ms.TotalAlloc) / 1024 / 1024,
		SysMB:        float64(ms.Sys) / 1024 / 1024,
		NumGC:        ms.NumGC,
	})
}

func (s *HTTPServer) getTimeSeries(c *gin.Context) {
	if s.timeSeries == nil {
		c.JSON(http.StatusOK, []timeseries.DataPoint{})
		return
	}

	n, _ := c.GetQueryInt("n")
	if n <= 0 {
		n = 100
	}

	data := s.timeSeries.GetLastN(n)
	c.JSON(http.StatusOK, data)
}

func (s *HTTPServer) getFailureStats(c *gin.Context) {
	failureStats := s.clientMgr.GetFailureStats()
	if failureStats == nil {
		c.JSON(http.StatusOK, gin.H{"error": "failure stats not available"})
		return
	}

	summary := failureStats.GetSummary()
	c.JSON(http.StatusOK, gin.H{
		"total_failures":          summary.TotalFailures,
		"total_downtime_seconds":  summary.TotalDowntime.Seconds(),
		"avg_downtime_seconds":    summary.AvgDowntime.Seconds(),
		"total_reconnects":        summary.TotalReconnects,
		"successful_reconnects":   summary.SuccessfulReconnects,
		"failed_reconnects":       summary.FailedReconnects,
		"reconnect_success_rate":  summary.ReconnectSuccessRate,
		"messages_during_failure": summary.MessagesDuringFailure,
		"messages_after_recovery": summary.MessagesAfterRecovery,
		"duplicate_messages":      summary.DuplicateMessages,
		"unconfirmed_messages":    summary.UnconfirmedMessages,
		"is_in_failure":           summary.IsInFailure,
		"last_failure":            summary.LastFailure,
	})
}

func (s *HTTPServer) getFailureEvents(c *gin.Context) {
	failureStats := s.clientMgr.GetFailureStats()
	if failureStats == nil {
		c.JSON(http.StatusOK, []stats.FailureEvent{})
		return
	}

	events := failureStats.GetFailureEvents()
	c.JSON(http.StatusOK, events)
}

func (s *HTTPServer) injectFailure(c *gin.Context) {
	if err := s.clientMgr.InjectFailure(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Broker failure injected successfully",
		"status":  "reconnecting",
	})
}

func (s *HTTPServer) Start(host string, port int) error {
	addr := fmt.Sprintf("%s:%d", host, port)
	s.server = &http.Server{
		Addr:    addr,
		Handler: s.engine,
	}

	fmt.Printf("HTTP server starting on %s\n", addr)

	go func() {
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("HTTP server error: %v\n", err)
		}
	}()

	return nil
}

func (s *HTTPServer) Stop() error {
	if s.server != nil {
		return s.server.Close()
	}
	return nil
}
