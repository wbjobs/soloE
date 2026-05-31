# 分布式任务队列监控系统

一个轻量级的任务队列监控系统，包含数据采集、API服务和可视化面板三个独立模块。

## 系统架构

```
┌─────────────┐      HTTP POST      ┌─────────────┐
│  Collector  │ ──────────────────> │  API Server │
│ (数据采集器) │      每5秒          │  (FastAPI)  │
└─────────────┘                     └──────┬──────┘
                                             │
                                             ▼
                                        ┌─────────┐
                                        │ SQLite  │
                                        │  数据库  │
                                        └────┬────┘
                                             │
┌─────────────┐        HTTP GET        ┌──────▼──────┐
│  Dashboard  │ <──────────────────────│  API Server │
│  (可视化)   │     实时数据查询        │             │
└─────────────┘                        └─────────────┘
```

## 目录结构

```
.
├── collector/          # 数据采集器
│   ├── collector.py    # 主程序
│   └── requirements.txt
├── server/            # API服务
│   ├── main.py        # FastAPI主程序
│   └── requirements.txt
└── dashboard/         # 可视化面板
    ├── src/
    │   ├── App.vue
    │   ├── main.js
    │   └── components/
    │       └── TaskChart.vue
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## 快速开始

### 1. 启动 API 服务

```bash
cd server
pip install -r requirements.txt
python main.py
```

服务将运行在 `http://localhost:8000`

### 2. 启动数据采集器

```bash
cd collector
pip install -r requirements.txt
python collector.py
```

采集器将每5秒向API发送模拟任务数据。

### 3. 启动可视化面板

```bash
cd dashboard
npm install
npm run dev
```

面板将运行在 `http://localhost:3000`

## API 接口文档

### POST /api/v1/tasks

批量创建任务记录。

**请求体：**
```json
{
  "tasks": [
    {
      "task_id": "task_123",
      "task_name": "send_email",
      "status": "SUCCESS",
      "worker_name": "worker-01",
      "execution_time": 2.5,
      "queue_name": "default",
      "retries": 0,
      "timestamp": "2024-01-01T12:00:00"
    }
  ]
}
```

### GET /api/v1/tasks

查询任务列表。

**查询参数：**
- `status`: 状态过滤
- `task_name`: 任务名称过滤
- `worker_name`: Worker名称过滤
- `limit`: 返回数量限制 (默认 100)
- `offset`: 偏移量

### GET /api/v1/tasks/stats

获取每分钟任务统计数据。

**查询参数：**
- `minutes`: 查询最近多少分钟的数据 (默认 60)

**响应示例：**
```json
{
  "stats": [
    {
      "minute": "2024-01-01 12:00:00",
      "success_count": 10,
      "failed_count": 2,
      "total_count": 12
    }
  ],
  "minutes": 60
}
```

### GET /api/v1/health

健康检查接口。

## 命令行工具 (CLI)

在 `server/` 目录下提供了 `cli.py` 命令行工具，用于快速查询数据：

### 列出所有 Worker

```bash
python cli.py list-workers
```

输出示例：
```
==================================================
所有活跃过的 Worker
==================================================
 1. worker-01            (处理过 42 个任务)
 2. worker-02            (处理过 38 个任务)
==================================================
```

### 查询指定日期统计

```bash
python cli.py stats --date 2024-05-15
```

输出示例：
```
============================================================
任务统计 - 2024-05-15
============================================================
总任务数:      120
成功任务数:    110
失败任务数:    10
任务成功率:    91.67%
平均执行时间:  4.23 秒
============================================================
```

## 功能特性

### 采集器 (Collector)
- ✅ 模拟生成任务队列元数据
- ✅ 每5秒自动发送数据到API
- ✅ 支持多种任务状态（SUCCESS/FAILED/PENDING/RUNNING）
- ✅ 包含任务执行时间、重试次数等信息

### API 服务 (Server)
- ✅ 基于 FastAPI 的高性能 REST API
- ✅ SQLite 数据持久化存储
- ✅ CORS 跨域支持
- ✅ 任务数据批量接收
- ✅ 多条件查询支持
- ✅ 每分钟任务统计聚合

### 可视化面板 (Dashboard)
- ✅ Vue 3 + Vite 现代化前端
- ✅ ECharts 实时折线图
- ✅ 任务状态统计卡片
- ✅ 最近任务列表展示
- ✅ 每5秒自动刷新数据
- ✅ 响应式设计

## 技术栈

- **采集器:** Python, requests, schedule
- **API服务:** FastAPI, SQLAlchemy, SQLite, Uvicorn
- **可视化:** Vue 3, Vite, ECharts

## 许可证

MIT
