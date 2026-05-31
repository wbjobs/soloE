package main

import (
	"log"
	"p2p-cdn/internal/handler"
	"p2p-cdn/internal/service"
	"p2p-cdn/pkg/middleware"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()

	config := cors.DefaultConfig()
	config.AllowAllOrigins = true
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"*"}
	r.Use(cors.New(config))

	r.Use(middleware.Logger())

	resourceStore := service.NewResourceStore()
	trackerService := service.NewTrackerService()
	heartbeatService := service.NewHeartbeatService(trackerService)
	dhtService := service.NewDHTService("")
	redundancyService := service.NewRedundancyService(resourceStore, dhtService)
	hiddenSeedDiscovery := service.NewHiddenSeedDiscovery(dhtService, resourceStore, trackerService)
	bandwidthController := service.NewBandwidthController()
	geoIPService := service.NewGeoIPService()

	resourceHandler := handler.NewResourceHandler(resourceStore)
	trackerHandler := handler.NewTrackerHandler(trackerService)
	heartbeatHandler := handler.NewHeartbeatHandler(heartbeatService)
	redundancyHandler := handler.NewRedundancyHandler(redundancyService, hiddenSeedDiscovery, dhtService)
	bandwidthHandler := handler.NewBandwidthHandler(bandwidthController, geoIPService)

	api := r.Group("/api")
	{
		api.POST("/resource", resourceHandler.UploadResource)
		api.GET("/resource", resourceHandler.ListResources)
		api.GET("/resource/:id", resourceHandler.GetResource)
		api.GET("/resource/:id/chunks", resourceHandler.GetChunks)

		api.GET("/tracker/announce", trackerHandler.Announce)
		api.GET("/tracker/scrape", trackerHandler.Scrape)

		api.POST("/heartbeat", heartbeatHandler.ReportHeartbeat)

		api.GET("/redundancy/availability", redundancyHandler.GetAllAvailability)
		api.GET("/redundancy/availability/:id", redundancyHandler.GetAvailability)
		api.GET("/redundancy/tasks", redundancyHandler.GetReplicationTasks)
		api.POST("/redundancy/trigger", redundancyHandler.TriggerReplication)

		api.GET("/dht/nodes", redundancyHandler.GetDHTNodes)

		api.GET("/probe/active", redundancyHandler.GetActiveProbes)
		api.POST("/probe/trigger", redundancyHandler.TriggerProbe)

		api.GET("/network/stats", redundancyHandler.GetNetworkStats)

		api.GET("/bandwidth/status", bandwidthHandler.GetStatus)
		api.PUT("/bandwidth/config", bandwidthHandler.UpdateConfig)
		api.GET("/bandwidth/history", bandwidthHandler.GetSpeedHistory)

		api.GET("/geo/location", bandwidthHandler.GetGeoLocation)
		api.GET("/geo/stats", bandwidthHandler.GetPeerGeoStats)
	}

	log.Println("Server starting on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
