package handler

import (
	"net/http"
	"strconv"

	"p2p-cdn/internal/service"

	"github.com/gin-gonic/gin"
)

type BandwidthHandler struct {
	bandwidthController *service.BandwidthController
	geoIPService        *service.GeoIPService
}

func NewBandwidthHandler(bc *service.BandwidthController, geoIP *service.GeoIPService) *BandwidthHandler {
	return &BandwidthHandler{
		bandwidthController: bc,
		geoIPService:        geoIP,
	}
}

type BandwidthConfigRequest struct {
	Enabled            bool  `json:"enabled"`
	UploadLimitKBps    int64 `json:"uploadLimitKBps"`
	DownloadLimitKBps  int64 `json:"downloadLimitKBps"`
}

type BandwidthStatusResponse struct {
	Config              service.BandwidthConfig `json:"config"`
	CurrentUploadSpeed  int64                   `json:"currentUploadSpeedBps"`
	CurrentDownloadSpeed int64                  `json:"currentDownloadSpeedBps"`
	TotalUploaded       int64                   `json:"totalUploaded"`
	TotalDownloaded     int64                   `json:"totalDownloaded"`
}

func (bh *BandwidthHandler) GetStatus(c *gin.Context) {
	status := BandwidthStatusResponse{
		Config:              bh.bandwidthController.GetConfig(),
		CurrentUploadSpeed:  bh.bandwidthController.GetCurrentUploadSpeed(),
		CurrentDownloadSpeed: bh.bandwidthController.GetCurrentDownloadSpeed(),
		TotalUploaded:       bh.bandwidthController.GetTotalUploaded(),
		TotalDownloaded:     bh.bandwidthController.GetTotalDownloaded(),
	}
	c.JSON(http.StatusOK, status)
}

func (bh *BandwidthHandler) UpdateConfig(c *gin.Context) {
	var req BandwidthConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.UploadLimitKBps < 0 || req.DownloadLimitKBps < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Limit cannot be negative"})
		return
	}

	config := service.BandwidthConfig{
		Enabled:            req.Enabled,
		UploadLimitKBps:    req.UploadLimitKBps,
		DownloadLimitKBps:  req.DownloadLimitKBps,
	}

	bh.bandwidthController.ApplyConfig(config)
	c.JSON(http.StatusOK, gin.H{"message": "Config updated successfully"})
}

func (bh *BandwidthHandler) GetSpeedHistory(c *gin.Context) {
	type HistoryResponse struct {
		Upload   []SpeedSampleResponse `json:"upload"`
		Download []SpeedSampleResponse `json:"download"`
	}

	uploadHistory := bh.bandwidthController.GetUploadHistory()
	downloadHistory := bh.bandwidthController.GetDownloadHistory()

	uploadResp := make([]SpeedSampleResponse, len(uploadHistory))
	for i, s := range uploadHistory {
		uploadResp[i] = SpeedSampleResponse{
			Timestamp: s.Timestamp.Unix(),
			SpeedKBps: s.Speed / 1024,
			TimeStr:   s.Timestamp.Format("15:04:05"),
		}
	}

	downloadResp := make([]SpeedSampleResponse, len(downloadHistory))
	for i, s := range downloadHistory {
		downloadResp[i] = SpeedSampleResponse{
			Timestamp: s.Timestamp.Unix(),
			SpeedKBps: s.Speed / 1024,
			TimeStr:   s.Timestamp.Format("15:04:05"),
		}
	}

	c.JSON(http.StatusOK, HistoryResponse{
		Upload:   uploadResp,
		Download: downloadResp,
	})
}

type SpeedSampleResponse struct {
	Timestamp int64  `json:"timestamp"`
	SpeedKBps int64  `json:"speedKBps"`
	TimeStr   string `json:"timeStr"`
}

func (bh *BandwidthHandler) GetGeoLocation(c *gin.Context) {
	ip := c.Query("ip")
	if ip == "" {
		ip = c.ClientIP()
	}

	location, err := bh.geoIPService.GetLocation(ip)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, location)
}

func (bh *BandwidthHandler) GetPeerGeoStats(c *gin.Context) {
	peerCount, _ := strconv.Atoi(c.DefaultQuery("peers", "10"))
	
	demoPeers := bh.generateDemoPeers(peerCount)
	stats := bh.geoIPService.CalculateGeoStats(demoPeers)
	
	c.JSON(http.StatusOK, stats)
}

func (bh *BandwidthHandler) generateDemoPeers(count int) []service.Peer {
	peers := make([]service.Peer, count)
	for i := 0; i < count; i++ {
		ip := service.GenerateRandomIP()
		geo, _ := bh.geoIPService.GetLocation(ip)
		peers[i] = service.Peer{
			ID:       "peer-" + strconv.Itoa(i),
			IP:       ip,
			GeoInfo:  geo,
			IsSeeder: i%2 == 0,
		}
	}
	return peers
}
