# 高级功能使用指南

本文档介绍三个高级功能的使用方法：
1. LSTM异常预测
2. 自定义规则引擎
3. 自愈动作编排

---

## 1. LSTM异常预测功能

### 功能说明
基于LSTM神经网络进行时序预测，提前30秒预警即将发生的异常。

### API接口

**获取预测结果**
```http
GET /api/v1/prediction/{device_id}
Authorization: Bearer <tenant-api-key>
```

**响应示例**：
```json
{
  "has_prediction": true,
  "tenant_id": "tenant-uuid",
  "device_id": "device-001",
  "prediction_time": "2024-01-15T10:30:00Z",
  "predicted_values": [
    [75.2, 0.8, 10.5],
    [78.5, 0.9, 10.8],
    [82.1, 1.1, 11.2],
    [85.8, 1.3, 11.5],
    [89.5, 1.5, 11.8],
    [93.2, 1.7, 12.1]
  ],
  "anomaly_probability": 0.85,
  "will_anomaly": true,
  "time_to_anomaly": 30000000000
}
```

### 配置说明
- 历史窗口大小：60个数据点
- 预测步长：6步（每步5秒，共30秒预测）
- 异常阈值：概率 > 0.7 视为即将异常

---

## 2. 自定义规则引擎

### 功能说明
支持动态规则表达式，支持AND/OR逻辑、内置函数、变量引用。

### 规则表达式语法

**基础比较**：
```
temperature > 80
vibration <= 1.5
current != 0
```

**逻辑组合**：
```
temperature > 80 AND vibration > 2.0
temperature > 90 OR current > 15
(temperature > 80 AND vibration > 2.0) OR current > 15
```

**内置函数**：
- `avg(a, b, c...)` - 计算平均值
- `max(a, b, c...)` - 取最大值
- `min(a, b, c...)` - 取最小值
- `abs(x)` - 取绝对值
- `rate(a, b)` - 计算变化率

**函数示例**：
```
avg(temperature, 75) > 80
rate(temperature, 70) > 0.2
```

### API接口

**创建规则**：
```http
POST /api/v1/rules
Authorization: Bearer <tenant-api-key>
Content-Type: application/json

{
  "name": "High Temperature Alert",
  "description": "Trigger when temperature exceeds 80C",
  "expression": "temperature > 80 AND vibration > 2.0",
  "enabled": true,
  "severity": "critical",
  "action_type": "webhook",
  "action_config": {
    "url": "https://example.com/webhook",
    "method": "POST"
  }
}
```

**获取所有规则**：
```http
GET /api/v1/rules
Authorization: Bearer <tenant-api-key>
```

**删除规则**：
```http
DELETE /api/v1/rules/{rule_id}
Authorization: Bearer <tenant-api-key>
```

**评估规则**：
```http
POST /api/v1/rules/evaluate
Authorization: Bearer <tenant-api-key>
Content-Type: application/json

{
  "device_id": "device-001",
  "temperature": 85.5,
  "vibration": 2.5,
  "current": 12.0,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## 3. 自愈动作编排引擎

### 功能说明
支持复杂的自愈工作流编排，包括：
- 串行执行（Sequence）
- 并行执行（Parallel）
- 条件判断（Condition）
- 动作重试机制

### 动作类型

| 类型 | 说明 | 配置项 |
|------|------|--------|
| `webhook` | 调用Webhook | `url`, `secret`, `timeout` |
| `email` | 发送邮件 | `to`, `subject`, `body` |
| `command` | 执行命令 | `command` |
| `delay` | 延迟等待 | `duration_ms` |
| `sequence` | 串行执行子动作 | `actions`, `stop_on_error` |
| `parallel` | 并行执行子动作 | `actions` |
| `condition` | 条件分支 | `condition`, `then`, `else` |

### API接口

**创建动作计划**：
```http
POST /api/v1/actions
Authorization: Bearer <tenant-api-key>
Content-Type: application/json

{
  "id": "healing_workflow",
  "type": "sequence",
  "name": "Anomaly Healing Workflow",
  "enabled": true,
  "actions": [
    {
      "id": "notify_webhook",
      "type": "webhook",
      "name": "Notify Webhook",
      "enabled": true,
      "config": {
        "url": "https://example.com/webhook/healing"
      },
      "timeout": 30000000000
    },
    {
      "id": "wait_5s",
      "type": "delay",
      "name": "Wait 5 Seconds",
      "enabled": true,
      "config": {
        "duration_ms": 5000
      }
    },
    {
      "id": "check_severity",
      "type": "condition",
      "name": "Check Severity",
      "enabled": true,
      "condition": "severity > 0.8",
      "config": {
        "then": {
          "id": "escalate_email",
          "type": "email",
          "name": "Escalate to Admin",
          "enabled": true,
          "config": {
            "to": "admin@example.com",
            "subject": "Critical Anomaly",
            "body": "Please investigate immediately"
          }
        }
      }
    }
  ]
}
```

**创建默认自愈计划**：
```http
POST /api/v1/actions/default
Authorization: Bearer <tenant-api-key>
```

**执行动作计划**：
```http
POST /api/v1/actions/{plan_id}/execute
Authorization: Bearer <tenant-api-key>
Content-Type: application/json

{
  "device_id": "device-001",
  "event": {
    "id": "event-uuid",
    "anomaly_type": "spike",
    "severity": 0.9,
    "value": 95.5
  },
  "variables": {
    "severity": 0.9,
    "retry_count": 3
  }
}
```

**响应示例**：
```json
{
  "action_id": "healing_workflow",
  "action_name": "Anomaly Healing Workflow",
  "success": true,
  "duration": 5123456789,
  "sub_results": [
    {
      "action_id": "notify_webhook",
      "action_name": "Notify Webhook",
      "success": true,
      "duration": 123456789
    },
    {
      "action_id": "wait_5s",
      "action_name": "Wait 5 Seconds",
      "success": true,
      "duration": 5000000000
    },
    {
      "action_id": "check_severity",
      "action_name": "Check Severity",
      "success": true,
      "duration": 100000000,
      "sub_results": [
        {
          "action_id": "escalate_email",
          "action_name": "Escalate to Admin",
          "success": true,
          "duration": 50000000
        }
      ]
    }
  ]
}
```

---

## 完整使用流程示例

### 场景：温度异常自愈流程

1. **创建异常规则**：
```json
POST /api/v1/rules
{
  "name": "Critical Temperature",
  "expression": "temperature > 90",
  "enabled": true,
  "severity": "critical",
  "action_type": "workflow"
}
```

2. **创建自愈工作流**：
```json
POST /api/v1/actions
{
  "id": "temp_healing",
  "type": "sequence",
  "name": "Temperature Healing",
  "enabled": true,
  "actions": [
    {
      "id": "cooling_start",
      "type": "webhook",
      "name": "Start Cooling System",
      "config": { "url": "http://cooling/start" }
    },
    {
      "id": "wait_10s",
      "type": "delay",
      "config": { "duration_ms": 10000 }
    },
    {
      "id": "verify_temp",
      "type": "condition",
      "condition": "temperature > 80",
      "config": {
        "then": {
          "id": "notify_admin",
          "type": "email",
          "config": { "to": "admin@company.com" }
        }
      }
    }
  ]
}
```

3. **监控预测预警**：
定期调用 `/api/v1/prediction/{device_id}` 获取即将发生的异常预测。

4. **触发自愈**：
异常发生时调用 `/api/v1/actions/temp_healing/execute` 执行自愈流程。

---

## 性能说明

- LSTM预测：< 100ms
- 规则评估：< 10ms/规则
- 动作编排：取决于具体动作（网络IO为主）

所有高级功能均支持多租户隔离，每个租户的模型、规则、动作计划完全独立。
