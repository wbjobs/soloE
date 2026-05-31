# 时序数据异常检测 API 服务

基于 Go + TimescaleDB 开发的工业物联网传感器数据异常检测服务。

## 功能特性

- **传感器数据接收**: 接收温度、振动、电流等传感器数据
- **异常检测算法**: STL 时序分解 + 3σ 原则，支持检测:
  - 突刺 (Spike)
  - 阶跃 (Step)
  - 漂移 (Drift)
- **自愈机制**: 检测到异常后自动通过 Webhook 触发预设的自愈动作
- **异常事件查询**: 支持按时间范围和异常类型筛选查询
- **多租户隔离**: 通过 API Key 实现租户数据隔离

## 技术栈

- **Go 1.21+**
- **Gin Web Framework**
- **TimescaleDB** (PostgreSQL 时序扩展)
- **gonum/stat** (统计计算)
- **pgx** (PostgreSQL 驱动)

## 项目结构

```
anomaly-detection-api/
├── config/          # 配置加载
├── db/              # 数据库连接和初始化
├── handlers/        # HTTP 请求处理器
├── middleware/      # 中间件（租户认证）
├── models/          # 数据模型定义
├── repository/      # 数据访问层
├── services/        # 业务逻辑服务
│   ├── anomaly_detector.go  # 异常检测算法
│   └── webhook_service.go   # Webhook 服务
├── scripts/         # 初始化脚本
├── main.go          # 程序入口
└── go.mod           # 依赖管理
```

## 快速开始

### 1. 环境准备

确保已安装:
- Go 1.21+
- PostgreSQL + TimescaleDB

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库连接信息
```

### 3. 安装依赖

```bash
go mod download
```

### 4. 初始化数据库

```sql
CREATE DATABASE anomaly_db;
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

### 5. 初始化租户和 Webhook

```bash
go run scripts/init_tenant.go
```

### 6. 启动服务

```bash
go run main.go
```

服务将在 `http://localhost:8080` 启动。

## API 接口

所有接口都需要在请求头中携带租户 API Key:
```
Authorization: Bearer <your-api-key>
```

### 1. 提交传感器数据

```http
POST /api/v1/sensor/data
Content-Type: application/json

{
  "device_id": "device-001",
  "timestamp": "2024-01-15T10:00:00Z",
  "temperature": 75.5,
  "vibration": 2.3,
  "current": 10.2
}
```

### 2. 查询异常事件

```http
GET /api/v1/anomalies?start_time=2024-01-01T00:00:00Z&end_time=2024-01-15T23:59:59Z&anomaly_type=spike
```

查询参数:
- `start_time`: 开始时间 (RFC3339格式)，默认7天前
- `end_time`: 结束时间 (RFC3339格式)，默认当前时间
- `anomaly_type`: 异常类型筛选 (spike/step/drift)

## 异常检测算法说明

### STL 时序分解

STL (Seasonal and Trend decomposition using Loess) 将时间序列分解为三个部分:
- **Trend (趋势)**: 长期变化趋势
- **Seasonal (季节性)**: 周期性变化
- **Residual (残差)**: 剩余的随机波动

### 3σ 原则

基于正态分布假设，超过 3 倍标准差的数据点被视为异常:
- Z-score > 3.0: 判定为异常
- Severity = Z-score，表示异常的严重程度

### 异常类型分类

- **突刺 (Spike)**: Z-score > 4.5，单个数据点的剧烈偏离
- **阶跃 (Step)**: 近期均值与历史均值的差异 > 2.5σ
- **漂移 (Drift)**: 其他类型的异常，通常表示缓慢的趋势变化

## Webhook 说明

当检测到异常时，系统会向配置的 Webhook URL 发送 POST 请求:

```json
{
  "event_id": "uuid",
  "tenant_id": "tenant-uuid",
  "device_id": "device-001",
  "timestamp": "2024-01-15T10:00:00Z",
  "sensor_type": "temperature",
  "anomaly_type": "spike",
  "value": 150.5,
  "expected": 75.0,
  "severity": 5.2
}
```

请求头:
- `Content-Type: application/json`
- `X-Event-Type: anomaly_detected`
- `X-Signature: sha256=<hmac-signature>` (如果配置了 Secret)

## 多租户隔离

- 每个租户通过独立的 API Key 进行认证
- 所有数据库查询都强制携带 tenant_id 条件
- 租户之间的数据完全隔离

## 许可证

MIT
