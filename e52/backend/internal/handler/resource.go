package handler

import (
	"io"
	"net/http"

	"p2p-cdn/internal/service"

	"github.com/gin-gonic/gin"
)

type ResourceHandler struct {
	resourceStore *service.ResourceStore
}

func NewResourceHandler(resourceStore *service.ResourceStore) *ResourceHandler {
	return &ResourceHandler{
		resourceStore: resourceStore,
	}
}

func (rh *ResourceHandler) UploadResource(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided"})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open file"})
		return
	}
	defer src.Close()

	data, err := io.ReadAll(src)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file"})
		return
	}

	resource, err := rh.resourceStore.CreateResource(file.Filename, data)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create resource"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"resource":   resource,
		"magnetLink": resource.MagnetLink,
	})
}

func (rh *ResourceHandler) GetResource(c *gin.Context) {
	id := c.Param("id")
	resource, exists := rh.resourceStore.GetResource(id)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Resource not found"})
		return
	}

	rh.resourceStore.IncrementDownload(id)

	c.JSON(http.StatusOK, resource)
}

func (rh *ResourceHandler) GetChunks(c *gin.Context) {
	id := c.Param("id")
	resource, exists := rh.resourceStore.GetResource(id)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Resource not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"chunks": resource.Chunks})
}

func (rh *ResourceHandler) ListResources(c *gin.Context) {
	resources := rh.resourceStore.ListResources()
	c.JSON(http.StatusOK, gin.H{"resources": resources})
}
