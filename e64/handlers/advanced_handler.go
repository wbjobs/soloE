package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"anomaly-detection-api/services"
)

type AdvancedHandler struct {
	lstmPredictor *services.LSTMPredictor
	ruleEngine    *services.RuleEngine
	orchestrator  *services.Orchestrator
}

func NewAdvancedHandler(lp *services.LSTMPredictor, re *services.RuleEngine, o *services.Orchestrator) *AdvancedHandler {
	return &AdvancedHandler{
		lstmPredictor: lp,
		ruleEngine:    re,
		orchestrator:  o,
	}
}

func (h *AdvancedHandler) PredictAnomaly(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	deviceID := c.Param("device_id")

	result, err := h.lstmPredictor.Predict(c.Request.Context(), tenantID, deviceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *AdvancedHandler) CreateRule(c *gin.Context) {
	tenantID := c.GetString("tenant_id")

	var rule services.Rule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rule.TenantID = tenantID

	if err := h.ruleEngine.CreateRule(c.Request.Context(), &rule); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, rule)
}

func (h *AdvancedHandler) GetRules(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	rules := h.ruleEngine.GetRules(tenantID)
	c.JSON(http.StatusOK, gin.H{"rules": rules})
}

func (h *AdvancedHandler) DeleteRule(c *gin.Context) {
	ruleID := c.Param("id")
	h.ruleEngine.RemoveRule(ruleID)
	c.JSON(http.StatusOK, gin.H{"message": "Rule deleted"})
}

func (h *AdvancedHandler) EvaluateRules(c *gin.Context) {
	tenantID := c.GetString("tenant_id")

	var ctx services.RuleContext
	if err := c.ShouldBindJSON(&ctx); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	results, err := h.ruleEngine.Evaluate(c.Request.Context(), tenantID, &ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"results": results})
}

func (h *AdvancedHandler) CreateActionPlan(c *gin.Context) {
	tenantID := c.GetString("tenant_id")

	var plan services.Action
	if err := c.ShouldBindJSON(&plan); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.orchestrator.AddActionPlan(tenantID, &plan)
	c.JSON(http.StatusCreated, plan)
}

func (h *AdvancedHandler) GetActionPlans(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "List action plans endpoint"})
}

func (h *AdvancedHandler) ExecuteActionPlan(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	planID := c.Param("id")

	var execCtx services.ExecutionContext
	if err := c.ShouldBindJSON(&execCtx); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	execCtx.TenantID = tenantID
	execCtx.Variables = make(map[string]interface{})

	result, err := h.orchestrator.Execute(&execCtx, planID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *AdvancedHandler) CreateDefaultPlan(c *gin.Context) {
	tenantID := c.GetString("tenant_id")
	plan := services.CreateDefaultHealingPlan(tenantID)
	h.orchestrator.AddActionPlan(tenantID, plan)
	c.JSON(http.StatusCreated, plan)
}
