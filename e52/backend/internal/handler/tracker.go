package handler

import (
	"net/http"
	"strconv"
	"strings"

	"p2p-cdn/internal/service"

	"github.com/gin-gonic/gin"
)

type TrackerHandler struct {
	trackerService *service.TrackerService
}

func NewTrackerHandler(trackerService *service.TrackerService) *TrackerHandler {
	return &TrackerHandler{
		trackerService: trackerService,
	}
}

func (th *TrackerHandler) Announce(c *gin.Context) {
	infoHash := c.Query("info_hash")
	peerID := c.Query("peer_id")
	portStr := c.Query("port")
	uploadedStr := c.Query("uploaded")
	downloadedStr := c.Query("downloaded")
	leftStr := c.Query("left")
	event := c.Query("event")

	if infoHash == "" || peerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required parameters"})
		return
	}

	port, _ := strconv.Atoi(portStr)
	uploaded, _ := strconv.ParseInt(uploadedStr, 10, 64)
	downloaded, _ := strconv.ParseInt(downloadedStr, 10, 64)
	left, _ := strconv.ParseInt(leftStr, 10, 64)

	ip := c.ClientIP()

	peers := th.trackerService.Announce(infoHash, peerID, ip, port, uploaded, downloaded, left, event)

	c.JSON(http.StatusOK, gin.H{
		"interval": 60,
		"peers":    peers,
	})
}

func (th *TrackerHandler) Scrape(c *gin.Context) {
	infoHashesStr := c.Query("info_hash")
	if infoHashesStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing info_hash parameter"})
		return
	}

	infoHashes := strings.Split(infoHashesStr, ",")
	result := th.trackerService.Scrape(infoHashes)

	c.JSON(http.StatusOK, result)
}
