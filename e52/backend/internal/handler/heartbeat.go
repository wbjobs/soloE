package handler

import (
	"net/http"

	"p2p-cdn/internal/service"

	"github.com/gin-gonic/gin"
)

type HeartbeatHandler struct {
	heartbeatService *service.HeartbeatService
}

func NewHeartbeatHandler(heartbeatService *service.HeartbeatService) *HeartbeatHandler {
	return &HeartbeatHandler{
		heartbeatService: heartbeatService,
	}
}

func (hh *HeartbeatHandler) ReportHeartbeat(c *gin.Context) {
	var req struct {
		PeerID   string `json:"peerId" binding:"required"`
		InfoHash string `json:"infoHash" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	hh.heartbeatService.ReportHeartbeat(req.PeerID, req.InfoHash)

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
