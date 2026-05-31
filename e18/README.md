# 个人健康数据聚合平台

一个完整的健康数据聚合平台，包含数据源模拟、Go 后端服务和 Astro 前端展示。

## 项目结构

```
e18/
├── backend/          # Go (Gin) 后端服务
├── data-source/      # 模拟数据源 API 服务
├── frontend/         # Astro 前端应用
└── README.md
```

## 功能特性

- **数据源模拟**：
  - `/api/steps` - 返回 JSON 格式的步数数据
  - `/api/heart-rate` - 返回 CSV 格式的心率数据

- **后端服务** (Go + Gin)：
  - `/fetch` - 手动触发数据拉取
  - `/api/v1/summary` - 返回近7天平均步数和最高心率
  - 每小时自动定时拉取数据
  - PostgreSQL 数据存储

- **前端展示** (Astro)：
  - 响应式健康数据仪表盘
  - 实时数据刷新
  - 美观的渐变设计

## 快速开始

### 前置要求

- Go 1.21+
- Node.js 18+
- PostgreSQL

### 1. 启动 PostgreSQL 数据库

确保 PostgreSQL 已安装并运行，创建数据库：

```sql
CREATE DATABASE health_db;
```

默认连接配置：
- 主机：localhost
- 端口：5432
- 数据库：health_db
- 用户名：postgres
- 密码：postgres

### 2. 启动数据源模拟服务

```bash
cd data-source
npm install
npm start
```

服务运行在 http://localhost:3001

### 3. 启动 Go 后端服务

```bash
cd backend
go mod tidy
go run .
```

服务运行在 http://localhost:8080

### 4. 启动 Astro 前端

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:4321

## API 接口

### 后端服务

- **GET** `/fetch` - 手动拉取并存储最新数据
- **GET** `/api/v1/summary` - 获取健康摘要数据
- **GET** `/api/v1/export` - 导出所有数据为 ZIP 压缩包（包含 steps.csv 和 heart_rate.csv）

响应示例：
```json
{
  "average_steps_last_7_days": 7500.5,
  "max_heart_rate_last_7_days": 110,
  "generated_at": "2026-05-16T10:00:00Z"
}
```

### 数据源服务

- **GET** `/api/steps` - 获取步数数据 (JSON)
- **GET** `/api/heart-rate` - 获取心率数据 (CSV)

## 数据库表结构

### steps 表
- `id` - 主键
- `date` - 日期 (唯一)
- `steps` - 步数
- `created_at` - 创建时间

### heart_rate 表
- `id` - 主键
- `date` - 日期 (唯一)
- `heart_rate` - 心率
- `created_at` - 创建时间

## 配置说明

### 环境变量

后端支持以下环境变量：

- `DATABASE_URL` - PostgreSQL 连接字符串
  （默认：`postgres://postgres:postgres@localhost:5432/health_db?sslmode=disable`）

## 技术栈

- **后端**：Go, Gin, pgx, cron
- **数据库**：PostgreSQL
- **数据源**：Node.js, Express
- **前端**：Astro, 原生 JavaScript/CSS
