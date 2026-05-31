package main

import (
	"context"
	"fmt"
	"log"

	"anomaly-detection-api/config"
	"anomaly-detection-api/db"
	"anomaly-detection-api/models"
	"anomaly-detection-api/repository"
)

func main() {
	cfg := config.LoadConfig()

	if err := db.InitDB(cfg); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.CloseDB()

	ctx := context.Background()

	tenant := &models.Tenant{
		Name:   "Demo Tenant",
		APIKey: "demo-api-key-12345",
	}

	if err := repository.CreateTenant(ctx, tenant); err != nil {
		log.Printf("Tenant already exists or error: %v", err)
	} else {
		fmt.Printf("Created tenant: %s (ID: %s)\n", tenant.Name, tenant.ID)
		fmt.Printf("API Key: %s\n", tenant.APIKey)
	}

	webhookConfig := &models.WebhookConfig{
		TenantID: tenant.ID,
		URL:      "https://your-webhook-url.com/self-healing",
		Secret:   "your-webhook-secret",
		Enabled:  true,
	}

	if err := repository.CreateWebhookConfig(ctx, webhookConfig); err != nil {
		log.Printf("Webhook config error: %v", err)
	} else {
		fmt.Printf("Created webhook config: %s\n", webhookConfig.URL)
	}

	fmt.Println("\nInitialization complete!")
}
