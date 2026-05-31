package repository

import (
	"context"

	"anomaly-detection-api/db"
	"anomaly-detection-api/models"
)

func GetTenantByAPIKey(ctx context.Context, apiKey string) (*models.Tenant, error) {
	query := `
		SELECT id, name, api_key, created_at
		FROM tenants
		WHERE api_key = $1
	`
	var tenant models.Tenant
	err := db.Pool.QueryRow(ctx, query, apiKey).Scan(
		&tenant.ID, &tenant.Name, &tenant.APIKey, &tenant.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &tenant, nil
}

func GetWebhookConfigByTenant(ctx context.Context, tenantID string) (*models.WebhookConfig, error) {
	query := `
		SELECT id, tenant_id, url, secret, enabled, created_at
		FROM webhook_configs
		WHERE tenant_id = $1 AND enabled = TRUE
		LIMIT 1
	`
	var config models.WebhookConfig
	err := db.Pool.QueryRow(ctx, query, tenantID).Scan(
		&config.ID, &config.TenantID, &config.URL, &config.Secret,
		&config.Enabled, &config.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &config, nil
}

func CreateTenant(ctx context.Context, tenant *models.Tenant) error {
	query := `
		INSERT INTO tenants (name, api_key)
		VALUES ($1, $2)
		RETURNING id, created_at
	`
	return db.Pool.QueryRow(ctx, query, tenant.Name, tenant.APIKey).Scan(
		&tenant.ID, &tenant.CreatedAt,
	)
}

func CreateWebhookConfig(ctx context.Context, config *models.WebhookConfig) error {
	query := `
		INSERT INTO webhook_configs (tenant_id, url, secret, enabled)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at
	`
	return db.Pool.QueryRow(ctx, query, config.TenantID, config.URL, config.Secret, config.Enabled).Scan(
		&config.ID, &config.CreatedAt,
	)
}
