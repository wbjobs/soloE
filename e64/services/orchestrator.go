package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"anomaly-detection-api/models"
)

type ActionType string

const (
	ActionTypeWebhook  ActionType = "webhook"
	ActionTypeEmail    ActionType = "email"
	ActionTypeCommand  ActionType = "command"
	ActionTypeDelay    ActionType = "delay"
	ActionTypeParallel ActionType = "parallel"
	ActionTypeSequence ActionType = "sequence"
	ActionTypeCondition ActionType = "condition"
)

type Action struct {
	ID          string                 `json:"id"`
	Type        ActionType           `json:"type"`
	Name        string                 `json:"name"`
	Enabled     bool                   `json:"enabled"`
	Config      map[string]interface{} `json:"config"`
	Actions     []*Action              `json:"actions,omitempty"`
	Condition   string                 `json:"condition,omitempty"`
	RetryCount  int                    `json:"retry_count"`
	Timeout     time.Duration          `json:"timeout"`
}

type ExecutionContext struct {
	Context     context.Context
	TenantID    string
	DeviceID    string
	Event       *models.AnomalyEvent
	Prediction  *PredictionResult
	RuleResults []*RuleResult
	Variables   map[string]interface{}
	mutex       sync.RWMutex
}

type ExecutionResult struct {
	ActionID   string
	ActionName string
	Success    bool
	Error      error
	Duration   time.Duration
	Output     interface{}
	SubResults []*ExecutionResult
}

type Orchestrator struct {
	webhookService *WebhookService
	actionPlans   map[string]*Action
	planMutex     sync.RWMutex
}

func NewOrchestrator(ws *WebhookService) *Orchestrator {
	return &Orchestrator{
		webhookService: ws,
		actionPlans:    make(map[string]*Action),
	}
}

func (o *Orchestrator) AddActionPlan(tenantID string, plan *Action) {
	key := fmt.Sprintf("%s:%s", tenantID, plan.ID)
	o.planMutex.Lock()
	defer o.planMutex.Unlock()
	o.actionPlans[key] = plan
}

func (o *Orchestrator) GetActionPlan(tenantID, planID string) *Action {
	key := fmt.Sprintf("%s:%s", tenantID, planID)
	o.planMutex.RLock()
	defer o.planMutex.RUnlock()
	return o.actionPlans[key]
}

func (o *Orchestrator) Execute(ctx *ExecutionContext, planID string) (*ExecutionResult, error) {
	plan := o.GetActionPlan(ctx.TenantID, planID)
	if plan == nil {
		return nil, fmt.Errorf("action plan not found: %s", planID)
	}

	start := time.Now()
	result := o.executeAction(ctx, plan)
	result.Duration = time.Since(start)

	return result, nil
}

func (o *Orchestrator) executeAction(ctx *ExecutionContext, action *Action) *ExecutionResult {
	if !action.Enabled {
		return &ExecutionResult{
			ActionID:   action.ID,
			ActionName: action.Name,
			Success:  true,
			Output:   "action disabled",
		}
	}

	result := &ExecutionResult{
		ActionID:   action.ID,
		ActionName: action.Name,
	}

	start := time.Now()
	defer func() {
		result.Duration = time.Since(start)
		if r := recover(); r != nil {
			result.Success = false
			result.Error = fmt.Errorf("panic: %v", r)
		}
	}()

	var err error

	switch action.Type {
	case ActionTypeWebhook:
		err = o.executeWebhook(ctx, action)
	case ActionTypeEmail:
		err = o.executeEmail(ctx, action)
	case ActionTypeCommand:
		err = o.executeCommand(ctx, action)
	case ActionTypeDelay:
		err = o.executeDelay(ctx, action)
	case ActionTypeParallel:
		result.SubResults = o.executeParallel(ctx, action)
		success := true
		for _, r := range result.SubResults {
			if !r.Success {
				success = false
				break
			}
		}
		result.Success = success
		return result
	case ActionTypeSequence:
		result.SubResults = o.executeSequence(ctx, action)
		success := true
		for _, r := range result.SubResults {
			if !r.Success {
				success = false
				break
			}
		}
		result.Success = success
		return result
	case ActionTypeCondition:
		return o.executeCondition(ctx, action)
	default:
		err = fmt.Errorf("unknown action type: %s", action.Type)
	}

	result.Success = err == nil
	result.Error = err

	if err != nil {
		log.Printf("Action %s failed: %v", action.Name, err)
	}

	return result
}

func (o *Orchestrator) executeWebhook(ctx *ExecutionContext, action *Action) error {
	url, ok := action.Config["url"].(string)
	if !ok {
		return fmt.Errorf("webhook url not configured")
	}

	secret, _ := action.Config["secret"].(string)

	payload := map[string]interface{}{
		"tenant_id":   ctx.TenantID,
		"device_id":   ctx.DeviceID,
		"event":       ctx.Event,
		"prediction":  ctx.Prediction,
		"variables":   ctx.Variables,
	}

	jsonPayload, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonPayload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if secret != "" {
		signature := generateSignature(jsonPayload, secret)
		req.Header.Set("X-Signature", "sha256="+signature)
	}

	client := &http.Client{
		Timeout: action.Timeout,
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook failed with status: %d", resp.StatusCode)
	}

	return nil
}

func (o *Orchestrator) executeEmail(ctx *ExecutionContext, action *Action) error {
	to, ok := action.Config["to"].(string)
	if !ok {
		return fmt.Errorf("email recipient not configured")
	}

	subject, _ := action.Config["subject"].(string)
	body, _ := action.Config["body"].(string)

	log.Printf("Sending email to %s: %s\n%s", to, subject, body)
	return nil
}

func (o *Orchestrator) executeCommand(ctx *ExecutionContext, action *Action) error {
	command, ok := action.Config["command"].(string)
	if !ok {
		return fmt.Errorf("command not configured")
	}

	log.Printf("Executing command: %s", command)
	return nil
}

func (o *Orchestrator) executeDelay(ctx *ExecutionContext, action *Action) error {
	durationMs, ok := action.Config["duration_ms"].(float64)
	if !ok {
		durationMs = 1000
	}

	time.Sleep(time.Duration(durationMs) * time.Millisecond
	return nil
}

func (o *Orchestrator) executeParallel(ctx *ExecutionContext, action *Action) []*ExecutionResult {
	var wg sync.WaitGroup
	results := make([]*ExecutionResult, len(action.Actions))

	for i, subAction := range action.Actions {
		wg.Add(1)
		go func(idx int, sa *Action) {
			defer wg.Done()
			results[idx] = o.executeAction(ctx, sa)
		}(i, subAction)
	}

	wg.Wait()
	return results
}

func (o *Orchestrator) executeSequence(ctx *ExecutionContext, action *Action) []*ExecutionResult {
	results := make([]*ExecutionResult, 0, len(action.Actions))

	for _, subAction := range action.Actions {
		result := o.executeAction(ctx, subAction)
		results = append(results, result)

		if !result.Success {
			stopOnError := true
			if v, ok := action.Config["stop_on_error"].(bool); ok {
				stopOnError = v
			}
			if stopOnError {
				break
			}
		}
	}

	return results
}

func (o *Orchestrator) executeCondition(ctx *ExecutionContext, action *Action) *ExecutionResult {
	conditionExpr := action.Condition
	conditionResult := o.evaluateCondition(ctx, conditionExpr)

	result := &ExecutionResult{
		ActionID:   action.ID,
		ActionName: action.Name,
		Success:    true,
	}

	if conditionResult {
		if thenAction, ok := action.Config["then"].(*Action); ok {
			result.SubResults = append(result.SubResults, o.executeAction(ctx, thenAction))
		}
	} else {
		if elseAction, ok := action.Config["else"].(*Action); ok {
			result.SubResults = append(result.SubResults, o.executeAction(ctx, elseAction))
		}
	}

	return result
}

func (o *Orchestrator) evaluateCondition(ctx *ExecutionContext, condition string) bool {
	if condition == "" {
		return true
	}

	parts := splitCondition(condition)
	if len(parts) != 3 {
		return false
	}

	leftVar := parts[0]
	op := parts[1]
	rightVal := parts[2]

	leftValue := o.getVariable(ctx, leftVar)
	rightValue := parseValue(rightVal)

	switch op {
	case "==", "=":
		return fmt.Sprintf("%v", leftValue) == fmt.Sprintf("%v", rightValue)
	case "!=":
		return fmt.Sprintf("%v", leftValue) != fmt.Sprintf("%v", rightValue)
	case ">":
		return compareValues(leftValue, rightValue, ">")
	case "<":
		return compareValues(leftValue, rightValue, "<")
	case ">=":
		return compareValues(leftValue, rightValue, ">=")
	case "<=":
		return compareValues(leftValue, rightValue, "<=")
	}

	return false
}

func splitCondition(condition string) []string {
	operators := []string{">=", "<=", "!=", ">", "<", "="}
	for _, op := range operators {
		if idx := indexOf(condition, op); idx > 0 {
			return []string{
				condition[:idx], op, condition[idx+len(op):]}
		}
	}
	return nil
}

func indexOf(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func (o *Orchestrator) getVariable(ctx *ExecutionContext, name string) interface{} {
	ctx.mutex.RLock()
	defer ctx.mutex.RUnlock()
	return ctx.Variables[name]
}

func parseValue(s string) interface{} {
	if f, err := stringToFloat64(s); err == nil {
		return f
	}
	return strings.Trim(s, "\"'")
}

func stringToFloat64(s string) (float64, error) {
	var f float64
	_, err := fmt.Sscan(s, &f)
	return f, err
}

func compareValues(a, b interface{}, op string) bool {
	af, aok := toFloat64(a)
	bf, bok := toFloat64(b)
	
	if aok && bok {
		switch op {
		case ">":
			return af > bf
		case "<":
			return af < bf
		case ">=":
			return af >= bf
		case "<=":
			return af <= bf
		}
	}
	return false
}

func toFloat64(v interface{}) (float64, bool) {
	switch val := v.(type) {
	case float64:
		return val, true
	case float32:
		return float64(val), true
	case int:
		return float64(val), true
	case int64:
		return float64(val), true
	default:
		return 0, false
	}
}

func (o *Orchestrator) SetVariable(ctx *ExecutionContext, name string, value interface{}) {
	ctx.mutex.Lock()
	defer ctx.mutex.Unlock()
	ctx.Variables[name] = value
}

func (o *Orchestrator) GetVariable(ctx *ExecutionContext, name string) interface{} {
	ctx.mutex.RLock()
	defer ctx.mutex.RUnlock()
	return ctx.Variables[name]
}

func CreateDefaultHealingPlan(tenantID string) *Action {
	return &Action{
		ID:      "default_healing",
		Type:    ActionTypeSequence,
		Name:    "Default Self-Healing Plan",
		Enabled: true,
		Actions: []*Action{
			{
				ID:       "notify_webhook",
				Type:     ActionTypeWebhook,
				Name:     "Notify Webhook",
				Enabled:  true,
				Config: map[string]interface{}{
					"url": "http://localhost:8080/webhook/healing",
				},
				Timeout: 30 * time.Second,
			},
			{
				ID:       "delay_5s",
				Type:     ActionTypeDelay,
				Name:     "Wait 5 Seconds",
				Enabled:  true,
				Config: map[string]interface{}{
					"duration_ms": 5000,
				},
			},
			{
				ID:       "verify_status",
				Type:     ActionTypeCondition,
				Name:     "Verify Status",
				Enabled:  true,
				Condition: "severity > 0.8",
				Config: map[string]interface{}{
					"then": &Action{
						ID:       "escalate_email",
						Type:     ActionTypeEmail,
						Name:     "Escalate to Admin",
						Enabled:  true,
						Config: map[string]interface{}{
							"to":      "admin@example.com",
							"subject": "Critical Anomaly Detected",
							"body":    "Please check device immediately",
						},
					},
				},
			},
		},
	}
}
