package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"anomaly-detection-api/config"
	"anomaly-detection-api/db"
	"anomaly-detection-api/handlers"
	"anomaly-detection-api/middleware"
	"anomaly-detection-api/services"
)

var validate *validator.Validate

func main() {
	validate = validator.New()

	cfg := config.LoadConfig()

	if err := db.InitDB(cfg); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.CloseDB()

	if err := db.InitSchema(); err != nil {
		log.Fatalf("Failed to initialize schema: %v", err)
	}

	batchProcessor := services.NewBatchProcessor(500, 500*time.Millisecond)
	defer batchProcessor.Stop()

	webhookService := services.NewWebhookService()
	lstmPredictor := services.NewLSTMPredictor(60, 6)
	ruleEngine := services.NewRuleEngine()
	orchestrator := services.NewOrchestrator(webhookService)

	r := gin.Default()

	sensorHandler := handlers.NewSensorHandler(batchProcessor)
	anomalyHandler := handlers.NewAnomalyHandler()
	advancedHandler := handlers.NewAdvancedHandler(lstmPredictor, ruleEngine, orchestrator)

	api := r.Group("/api/v1")
	api.Use(middleware.TenantAuth())
	{
		sensor := api.Group("/sensor")
		{
			sensor.POST("/data", sensorHandler.SubmitData)
			sensor.POST("/data/batch", sensorHandler.SubmitBatchData)
		}

		anomalies := api.Group("/anomalies")
		{
			anomalies.GET("", anomalyHandler.GetEvents)
		}

		prediction := api.Group("/prediction")
		{
			prediction.GET("/:device_id", advancedHandler.PredictAnomaly)
		}

		rules := api.Group("/rules")
		{
			rules.GET("", advancedHandler.GetRules)
			rules.POST("", advancedHandler.CreateRule)
			rules.DELETE("/:id", advancedHandler.DeleteRule)
			rules.POST("/evaluate", advancedHandler.EvaluateRules)
		}

		actions := api.Group("/actions")
		{
			actions.GET("", advancedHandler.GetActionPlans)
			actions.POST("", advancedHandler.CreateActionPlan)
			actions.POST("/default", advancedHandler.CreateDefaultPlan)
			actions.POST("/:id/execute", advancedHandler.ExecuteActionPlan)
		}
	}

	srv := &http.Server{
		Addr:    ":" + cfg.ServerPort,
		Handler: r,
	}

	go func() {
		log.Printf("Server starting on port %s", cfg.ServerPort)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exiting")
}
