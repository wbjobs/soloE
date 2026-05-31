package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"anomaly-detection-api/repository"
)

func TenantAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization format"})
			c.Abort()
			return
		}

		apiKey := parts[1]
		tenant, err := repository.GetTenantByAPIKey(c.Request.Context(), apiKey)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			c.Abort()
			return
		}

		c.Set("tenant_id", tenant.ID)
		c.Set("tenant", tenant)
		c.Next()
	}
}
