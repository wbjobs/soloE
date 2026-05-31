package handler

import (
	"net/http"
	"p2p-cdn/internal/service"

	"github.com/gin-gonic/gin"
)

type RedundancyHandler struct {
	redundancyService  *service.RedundancyService
	hiddenSeedDiscovery *service.HiddenSeedDiscovery
	dhtService         *service.DHTService
}

func NewRedundancyHandler(rs *service.RedundancyService, hsd *service.HiddenSeedDiscovery, dht *service.DHTService) *RedundancyHandler {
	return &RedundancyHandler{
		redundancyService:  rs,
		hiddenSeedDiscovery: hsd,
		dhtService:         dht,
	}
}

func (rh *RedundancyHandler) GetAvailability(c *gin.Context) {
	resourceID := c.Param("id")
	availability := rh.redundancyService.GetResourceChunksAvailability(resourceID)

	c.JSON(http.StatusOK, gin.H{
		"resourceId":    resourceID,
		"chunks":        availability,
		"minReplicas":   service.MinReplicas,
		"chunkCount":    len(availability),
	})
}

func (rh *RedundancyHandler) GetAllAvailability(c *gin.Context) {
	availability := rh.redundancyService.GetAllAvailability()
	c.JSON(http.StatusOK, gin.H{"chunks": availability})
}

func (rh *RedundancyHandler) GetReplicationTasks(c *gin.Context) {
	tasks := rh.redundancyService.GetReplicationTasks()
	c.JSON(http.StatusOK, gin.H{"tasks": tasks})
}

func (rh *RedundancyHandler) TriggerReplication(c *gin.Context) {
	var req struct {
		ChunkHash string `json:"chunkHash" binding:"required"`
		ResourceID string `json:"resourceId" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rh.redundancyService.RecordChunkDownload(req.ChunkHash, req.ResourceID)

	c.JSON(http.StatusOK, gin.H{"status": "replication_triggered"})
}

func (rh *RedundancyHandler) GetDHTNodes(c *gin.Context) {
	nodes := rh.dhtService.GetAllNodes()
	c.JSON(http.StatusOK, gin.H{
		"nodes": nodes,
		"count": len(nodes),
	})
}

func (rh *RedundancyHandler) GetActiveProbes(c *gin.Context) {
	probes := rh.hiddenSeedDiscovery.GetActiveProbes()
	c.JSON(http.StatusOK, gin.H{
		"probes": probes,
		"count":  len(probes),
	})
}

func (rh *RedundancyHandler) TriggerProbe(c *gin.Context) {
	var req struct {
		InfoHash   string `json:"infoHash" binding:"required"`
		ResourceID string `json:"resourceId" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rh.hiddenSeedDiscovery.TriggerProbe(req.InfoHash, req.ResourceID)

	c.JSON(http.StatusOK, gin.H{"status": "probe_triggered"})
}

func (rh *RedundancyHandler) GetNetworkStats(c *gin.Context) {
	nodeCount := rh.dhtService.GetNodeCount()
	allAvailability := rh.redundancyService.GetAllAvailability()
	activeProbes := rh.hiddenSeedDiscovery.GetActiveProbes()

	lowAvailabilityChunks := 0
	hotChunks := 0
	for _, avail := range allAvailability {
		if avail.ReplicaCount < service.MinReplicas {
			lowAvailabilityChunks++
		}
		if avail.IsHot {
			hotChunks++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"nodeCount":            nodeCount,
		"totalChunksTracked":  len(allAvailability),
		"lowAvailabilityChunks": lowAvailabilityChunks,
		"hotChunks":            hotChunks,
		"activeProbes":         len(activeProbes),
		"minReplicas":         service.MinReplicas,
	})
}
