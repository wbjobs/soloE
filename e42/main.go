package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"distributed-scheduler/api"
	"distributed-scheduler/config"
	"distributed-scheduler/models"
	"distributed-scheduler/queue"
	"distributed-scheduler/scheduler"
	"distributed-scheduler/worker"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
)

func main() {
	log := logrus.New()
	log.SetFormatter(&logrus.JSONFormatter{})
	log.SetOutput(os.Stdout)
	log.SetLevel(logrus.InfoLevel)

	cfg := config.Load()

	db, err := models.NewDB(cfg.PostgresDSN)
	if err != nil {
		log.WithError(err).Fatal("Failed to connect to database")
	}
	log.Info("Successfully connected to database")

	redisQueue := queue.NewRedisPriorityQueue(
		cfg.RedisAddr,
		cfg.RedisPass,
		cfg.RedisDB,
		"task_queue",
	)

	if err := redisQueue.Ping(context.Background()); err != nil {
		log.WithError(err).Fatal("Failed to connect to Redis")
	}
	log.Info("Successfully connected to Redis")

	sched := scheduler.NewScheduler(db, redisQueue, log)

	handler := api.NewHandler(sched)

	workerPool := worker.NewWorkerPool(
		sched,
		log,
		cfg.WorkerCount,
	)

	r := gin.Default()

	api.SetupRoutes(r, handler)

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "ok",
			"service": "distributed-scheduler",
		})
	})

	r.GET("/queue/status", func(c *gin.Context) {
		high, medium, low := redisQueue.Len(c.Request.Context())
		c.JSON(200, gin.H{
			"high_priority":   high,
			"medium_priority": medium,
			"low_priority":    low,
		})
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		if err := workerPool.Start(ctx); err != nil && err != context.Canceled {
			log.WithError(err).Error("Worker pool error")
		}
	}()

	go func() {
		log.WithField("port", cfg.ServerPort).Info("Starting HTTP server")
		if err := r.Run(cfg.ServerPort); err != nil {
			log.WithError(err).Fatal("Failed to start HTTP server")
		}
	}()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	log.Info("Shutting down gracefully...")
	cancel()
	log.Info("Shutdown complete")
}
