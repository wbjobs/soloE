package services

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"anomaly-detection-api/models"
	"anomaly-detection-api/repository"
)

type RuleEngine struct {
	rules      map[string]*Rule
	ruleMutex  sync.RWMutex
	functions  map[string]interface{}
}

type Rule struct {
	ID          string
	TenantID    string
	Name        string
	Description string
	Expression  string
	Enabled     bool
	Severity    string
	ActionType  string
	ActionConfig map[string]interface{}
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type RuleContext struct {
	DeviceID    string
	Temperature float64
	Vibration   float64
	Current     float64
	Timestamp   time.Time
	History     []*models.SensorData
	Prediction  *PredictionResult
}

type RuleResult struct {
	Matched     bool
	RuleID      string
	RuleName    string
	Severity    string
	Message     string
	ActionType  string
	ActionConfig map[string]interface{}
}

func NewRuleEngine() *RuleEngine {
	re := &RuleEngine{
		rules:     make(map[string]*Rule),
		functions: make(map[string]interface{}),
	}
	re.registerBuiltinFunctions()
	return re
}

func (re *RuleEngine) registerBuiltinFunctions() {
	re.functions["avg"] = func(args ...interface{}) (interface{}, error) {
		if len(args) == 0 {
			return 0.0, nil
		}
		sum := 0.0
		for _, arg := range args {
			switch v := arg.(type) {
			case float64:
				sum += v
			case int:
				sum += float64(v)
			default:
				return nil, fmt.Errorf("invalid type for avg")
			}
		}
		return sum / float64(len(args)), nil
	}

	re.functions["max"] = func(args ...interface{}) (interface{}, error) {
		if len(args) == 0 {
			return 0.0, nil
		}
		max := math.Inf(-1)
		for _, arg := range args {
			var v float64
			switch argVal := arg.(type) {
			case float64:
				v = argVal
			case int:
				v = float64(argVal)
			default:
				return nil, fmt.Errorf("invalid type for max")
			}
			if v > max {
				max = v
			}
		}
		return max, nil
	}

	re.functions["min"] = func(args ...interface{}) (interface{}, error) {
		if len(args) == 0 {
			return 0.0, nil
		}
		min := math.Inf(1)
		for _, arg := range args {
			var v float64
			switch argVal := arg.(type) {
			case float64:
				v = argVal
			case int:
				v = float64(argVal)
			default:
				return nil, fmt.Errorf("invalid type for min")
			}
			if v < min {
				min = v
			}
		}
		return min, nil
	}

	re.functions["abs"] = func(args ...interface{}) (interface{}, error) {
		if len(args) != 1 {
			return nil, fmt.Errorf("abs requires 1 argument")
		}
		switch v := args[0].(type) {
		case float64:
			return math.Abs(v), nil
		case int:
			return math.Abs(float64(v)), nil
		default:
			return nil, fmt.Errorf("invalid type for abs")
		}
	}

	re.functions["rate"] = func(args ...interface{}) (interface{}, error) {
		if len(args) != 2 {
			return nil, fmt.Errorf("rate requires 2 arguments")
		}
		v1, ok1 := args[0].(float64)
		v2, ok2 := args[1].(float64)
		if !ok1 || !ok2 {
			return nil, fmt.Errorf("rate requires float arguments")
		}
		return (v2 - v1) / v1, nil
	}

	re.functions["timeSince"] = func(args ...interface{}) (interface{}, error) {
		if len(args) != 1 {
			return nil, fmt.Errorf("timeSince requires 1 argument")
		}
		t, ok := args[0].(time.Time)
		if !ok {
			return nil, fmt.Errorf("timeSince requires time.Time argument")
		}
		return time.Since(t).Seconds(), nil
	}
}

func (re *RuleEngine) AddRule(rule *Rule) {
	re.ruleMutex.Lock()
	defer re.ruleMutex.Unlock()
	re.rules[rule.ID] = rule
}

func (re *RuleEngine) RemoveRule(ruleID string) {
	re.ruleMutex.Lock()
	defer re.ruleMutex.Unlock()
	delete(re.rules, ruleID)
}

func (re *RuleEngine) GetRules(tenantID string) []*Rule {
	re.ruleMutex.RLock()
	defer re.ruleMutex.RUnlock()

	var rules []*Rule
	for _, rule := range re.rules {
		if rule.TenantID == tenantID && rule.Enabled {
			rules = append(rules, rule)
		}
	}
	return rules
}

func (re *RuleEngine) Evaluate(ctx context.Context, tenantID string, data *RuleContext) ([]*RuleResult, error) {
	rules := re.GetRules(tenantID)
	var results []*RuleResult

	for _, rule := range rules {
		matched, err := re.evaluateExpression(rule.Expression, data)
		if err != nil {
			continue
		}

		if matched {
			result := &RuleResult{
				Matched:      true,
				RuleID:       rule.ID,
				RuleName:     rule.Name,
				Severity:     rule.Severity,
				Message:      fmt.Sprintf("Rule '%s' matched for device %s", rule.Name, data.DeviceID),
				ActionType:   rule.ActionType,
				ActionConfig: rule.ActionConfig,
			}
			results = append(results, result)
		}
	}

	return results, nil
}

func (re *RuleEngine) evaluateExpression(expr string, ctx *RuleContext) (bool, error) {
	expr = strings.TrimSpace(expr)
	
	if strings.HasPrefix(expr, "(") && strings.HasSuffix(expr, ")") {
		return re.evaluateExpression(expr[1:len(expr)-1], ctx)
	}

	if strings.Contains(expr, " AND ") {
		parts := strings.Split(expr, " AND ")
		for _, part := range parts {
			result, err := re.evaluateExpression(strings.TrimSpace(part), ctx)
			if err != nil || !result {
				return false, err
			}
		}
		return true, nil
	}

	if strings.Contains(expr, " OR ") {
		parts := strings.Split(expr, " OR ")
		for _, part := range parts {
			result, err := re.evaluateExpression(strings.TrimSpace(part), ctx)
			if err == nil && result {
				return true, nil
			}
		}
		return false, nil
	}

	return re.evaluateCondition(expr, ctx)
}

func (re *RuleEngine) evaluateCondition(condition string, ctx *RuleContext) (bool, error) {
	operators := []string{">=", "<=", "!=", ">", "<", "="}
	for _, op := range operators {
		if idx := strings.Index(condition, op); idx > 0 {
			left := strings.TrimSpace(condition[:idx])
			right := strings.TrimSpace(condition[idx+len(op):])

			leftValue, err := re.evaluateValue(left, ctx)
			if err != nil {
				return false, err
			}

			rightValue, err := re.evaluateValue(right, ctx)
			if err != nil {
				return false, err
			}

			return re.compareValues(leftValue, rightValue, op)
		}
	}

	return false, fmt.Errorf("invalid condition: %s", condition)
}

func (re *RuleEngine) evaluateValue(value string, ctx *RuleContext) (interface{}, error) {
	value = strings.TrimSpace(value)

	if f, err := strconv.ParseFloat(value, 64); err == nil {
		return f, nil
	}

	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t, nil
	}

	switch value {
	case "temperature":
		return ctx.Temperature, nil
	case "vibration":
		return ctx.Vibration, nil
	case "current":
		return ctx.Current, nil
	}

	if strings.Contains(value, "(") && strings.Contains(value, ")") {
		return re.evaluateFunction(value, ctx)
	}

	return value, nil
}

func (re *RuleEngine) evaluateFunction(call string, ctx *RuleContext) (interface{}, error) {
	funcName, argsStr := parseFunctionCall(call)
	argTokens := parseArguments(argsStr)
	
	var args []interface{}
	for _, token := range argTokens {
		val, err := re.evaluateValue(token, ctx)
		if err != nil {
			return nil, err
		}
		args = append(args, val)
	}

	if fn, ok := re.functions[funcName]; ok {
		switch f := fn.(type) {
		case func(...interface{}) (interface{}, error):
			return f(args...)
		}
	}

	return nil, fmt.Errorf("unknown function: %s", funcName)
}

func parseFunctionCall(call string) (string, string) {
	call = strings.TrimSpace(call)
	idx := strings.Index(call, "(")
	if idx == -1 {
		return call, ""
	}
	funcName := strings.TrimSpace(call[:idx])
	argsStr := strings.TrimSpace(call[idx+1 : len(call)-1])
	return funcName, argsStr
}

func parseArguments(argsStr string) []string {
	if argsStr == "" {
		return []string{}
	}
	
	var args []string
	var current string
	parenDepth := 0
	
	for _, c := range argsStr {
		switch c {
		case '(':
			parenDepth++
			current += string(c)
		case ')':
			parenDepth--
			current += string(c)
		case ',':
			if parenDepth == 0 {
				args = append(args, strings.TrimSpace(current))
				current = ""
			} else {
				current += string(c)
			}
		default:
			current += string(c)
		}
	}
	
	if current != "" {
		args = append(args, strings.TrimSpace(current))
	}
	
	return args
}

func (re *RuleEngine) compareValues(a, b interface{}, op string) (bool, error) {
	af, aok := toFloat(a)
	bf, bok := toFloat(b)
	
	if aok && bok {
		switch op {
		case ">":
			return af > bf, nil
		case "<":
			return af < bf, nil
		case ">=":
			return af >= bf, nil
		case "<=":
			return af <= bf, nil
		case "=":
			return math.Abs(af-bf) < 0.0001, nil
		case "!=":
			return math.Abs(af-bf) >= 0.0001, nil
		}
	}

	at, aokTime := a.(time.Time)
	bt, bokTime := b.(time.Time)
	
	if aokTime && bokTime {
		switch op {
		case ">":
			return at.After(bt), nil
		case "<":
			return at.Before(bt), nil
		case ">=":
			return !at.Before(bt), nil
		case "<=":
			return !at.After(bt), nil
		case "=":
			return at.Equal(bt), nil
		case "!=":
			return !at.Equal(bt), nil
		}
	}

	return false, fmt.Errorf("cannot compare values")
}

func toFloat(v interface{}) (float64, bool) {
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

func (re *RuleEngine) LoadRulesFromDB(ctx context.Context, tenantID string) error {
	return nil
}

func (re *RuleEngine) CreateRule(ctx context.Context, rule *Rule) error {
	rule.CreatedAt = time.Now()
	rule.UpdatedAt = time.Now()
	re.AddRule(rule)
	return nil
}
