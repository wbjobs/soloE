package api

import (
	"context"
	"net/http"

	"distributed-scheduler/models"
	"distributed-scheduler/scheduler"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Handler struct {
	scheduler *scheduler.Scheduler
}

func NewHandler(s *scheduler.Scheduler) *Handler {
	return &Handler{scheduler: s}
}

type SubmitDAGRequest struct {
	Name        string                     `json:"name" binding:"required"`
	Description string                     `json:"description"`
	Tasks       []scheduler.TaskDefinition `json:"tasks" binding:"required"`
}

type SubmitDAGResponse struct {
	DAGID string `json:"dag_id"`
	Status string `json:"status"`
	Message string `json:"message"`
}

func (h *Handler) SubmitDAG(c *gin.Context) {
	var req SubmitDAGRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dagDef := &scheduler.DAGDefinition{
		Name:        req.Name,
		Description: req.Description,
		Tasks:       req.Tasks,
	}

	dag, err := h.scheduler.CreateDAG(c.Request.Context(), dagDef)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	go func() {
		h.scheduler.ScheduleReadyTasks(context.Background(), dag.ID)
	}()

	c.JSON(http.StatusCreated, SubmitDAGResponse{
		DAGID:   dag.ID.String(),
		Status:  string(dag.Status),
		Message: "DAG submitted successfully",
	})
}

func (h *Handler) GetDAG(c *gin.Context) {
	dagIDStr := c.Param("id")
	dagID, err := uuid.Parse(dagIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid DAG ID"})
		return
	}

	dag, err := h.scheduler.GetDAG(c.Request.Context(), dagID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "DAG not found"})
		return
	}

	c.JSON(http.StatusOK, dag)
}

func (h *Handler) ListDAGs(c *gin.Context) {
	dags, err := h.scheduler.ListDAGs(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, dags)
}

type TriggerDAGRequest struct {
	DAGID string `json:"dag_id" binding:"required"`
}

func (h *Handler) TriggerDAG(c *gin.Context) {
	var req TriggerDAGRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dagID, err := uuid.Parse(req.DAGID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid DAG ID"})
		return
	}

	go func() {
		h.scheduler.ScheduleReadyTasks(context.Background(), dagID)
	}()

	c.JSON(http.StatusOK, gin.H{
		"message": "DAG triggered successfully",
		"dag_id":  dagID.String(),
	})
}

func SetupRoutes(r *gin.Engine, h *Handler) {
	api := r.Group("/api/v1")
	{
		api.POST("/dag", h.SubmitDAG)
		api.GET("/dag/:id", h.GetDAG)
		api.GET("/dag", h.ListDAGs)
		api.POST("/dag/trigger", h.TriggerDAG)
	}
}
