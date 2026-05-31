# Wind Farm Monitor Service

基于 Rust + Actix-web 的风机振动监控告警系统，实时接收 MQTT 振动数据并触发规则告警。

## 功能特性

- **MQTT 订阅**: 订阅 `wind/farm/+/vibration` 主题，接收多风机实时振动数据
- **规则引擎**: 支持通过 REST API 配置告警规则（比较运算符 + 连续次数判定）
- **告警存储**: 触发的告警自动写入 InfluxDB 时序数据库
- **查询接口**: 支持按风机、规则、时间范围查询告警历史

## 技术栈

- **Web 框架**: Actix-web 4
- **MQTT 客户端**: rumqttc
- **时序数据库**: InfluxDB 2.x
- **异步运行时**: Tokio
- **序列化**: Serde/Serde JSON
- **ID 生成**: UUID v4

## 快速开始

### 1. 环境配置

复制 `.env.example` 为 `.env` 并根据实际环境修改配置：

```bash
cp .env.example .env
```

配置项说明：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MQTT_BROKER` | MQTT Broker 地址 | `localhost` |
| `MQTT_PORT` | MQTT Broker 端口 | `1883` |
| `MQTT_TOPIC` | 订阅的主题（支持 + 通配符） | `wind/farm/+/vibration` |
| `INFLUXDB_URL` | InfluxDB 地址 | `http://localhost:8086` |
| `INFLUXDB_TOKEN` | InfluxDB 访问令牌 | - |
| `INFLUXDB_ORG` | InfluxDB 组织名 | `my-org` |
| `INFLUXDB_BUCKET` | InfluxDB Bucket 名 | `wind-farm` |
| `SERVER_HOST` | API 服务监听地址 | `0.0.0.0` |
| `SERVER_PORT` | API 服务端口 | `8080` |

### 2. 编译运行

```bash
cargo build --release
cargo run --release
```

## MQTT 数据格式

风机发送的振动数据 JSON 格式：

```json
{
  "fan_id": "fan-001",
  "timestamp": "2024-01-15T10:30:00Z",
  "freq_hz": 50.5,
  "magnitude": 0.75
}
```

## API 接口

### 健康检查

```
GET /api/health
```

### 创建告警规则

#### 连续匹配规则（传统模式）

```
POST /api/rules
Content-Type: application/json

{
  "name": "高振动告警",
  "condition": {
    "field": "Magnitude",
    "operator": "GreaterThan",
    "threshold": 0.8
  },
  "trigger": {
    "type": "Consecutive",
    "config": {
      "count": 3
    }
  }
}
```

#### 滑动窗口规则（新增）

```
POST /api/rules
Content-Type: application/json

{
  "name": "滑动窗口告警",
  "condition": {
    "field": "Magnitude",
    "operator": "GreaterThan",
    "threshold": 0.6
  },
  "trigger": {
    "type": "SlidingWindow",
    "config": {
      "window_size": 10,
      "min_matches": 6
    }
  }
}
```

**支持的字段 (field)**:
- `Magnitude` - 振动幅值
- `FreqHz` - 振动频率

**支持的运算符 (operator)**:
- `GreaterThan` - 大于
- `GreaterThanOrEqual` - 大于等于
- `LessThan` - 小于
- `LessThanOrEqual` - 小于等于
- `Equal` - 等于
- `NotEqual` - 不等于

**规则触发类型**:
- `Consecutive`: 连续 `count` 次满足条件才告警
- `SlidingWindow`: 最近 `window_size` 个数据中至少有 `min_matches` 个满足条件即告警

### 查询所有规则

```
GET /api/rules
```

### 查询单个规则

```
GET /api/rules/{rule_id}
```

### 删除规则

```
DELETE /api/rules/{rule_id}
```

### 更新规则条件

```
PUT /api/rules/{rule_id}/condition
Content-Type: application/json

{
  "condition": {
    "field": "Magnitude",
    "operator": "GreaterThan",
    "threshold": 0.9
  }
}
```

### 启用/禁用规则

```
PUT /api/rules/{rule_id}/enabled
Content-Type: application/json

{
  "enabled": false
}
```

### 查询告警历史

```
GET /api/alerts?fan_id=fan-001&rule_id=<uuid>&limit=100&start_time=2024-01-01T00:00:00Z&end_time=2024-02-01T00:00:00Z
```

**查询参数**:
- `fan_id` (可选): 按风机 ID 过滤
- `rule_id` (可选): 按规则 ID 过滤
- `start_time` (可选): 开始时间 (RFC3339 格式)
- `end_time` (可选): 结束时间 (RFC3339 格式)
- `limit` (可选): 返回结果数量限制

## 项目结构

```
src/
├── main.rs       # 程序入口
├── models.rs     # 数据模型定义
├── rules.rs      # 规则引擎实现
├── mqtt.rs       # MQTT 订阅模块
├── storage.rs    # InfluxDB 存储模块
└── api.rs        # REST API 路由
```
