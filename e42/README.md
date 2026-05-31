# 分布式任务调度系统 (Distributed Task Scheduler)

基于 Go + Gin + Redis + PostgreSQL 构建的分布式任务调度系统，支持DAG形式的任务编排和优先级抢占式调度。

## 核心功能

### 1. DAG任务编排
- 支持有向无环图(DAG)形式定义任务依赖关系
- 自动检测循环依赖
- 任务并行执行（无依赖任务同时执行）
- 按依赖顺序串行执行

### 2. 优先级抢占式调度
- 支持三级任务优先级: high / medium / low
- 高优先级任务进入队列时，可暂停正在执行的低优先级任务
- 通过Context Cancel机制实现任务抢占
- 抢占的任务自动保存检查点并在稍后恢复执行
- 抢占式调度循环(500ms检查一次队列状态)

### 3. 任务状态追踪
- pending: 等待执行
- ready: 准备执行
- running: 执行中
- paused: 已暂停（被抢占）
- resuming: 恢复执行中
- completed: 完成
- failed: 失败
- retrying: 重试中

### 4. 任务暂停与恢复机制
- 任务执行进度追踪(0-100%)
- 检查点数据持久化到数据库
- 自动从检查点恢复任务执行
- 恢复时会传递检查点上下文给外部服务

### 5. 任务调度与执行
- Redis优先级队列（三级队列：高/中/低）
- Goroutine池并发执行任务
- 可配置的工作池大小
- 任务执行时调用模拟的外部HTTP服务

### 6. 失败重试机制
- 每个任务最多重试3次（可配置）
- 重试间隔5秒
- 超过最大重试次数标记为失败

### 7. HTTP API接口
- 提交DAG任务（支持设置任务优先级）
- 查询DAG状态
- 列出所有DAG
- 触发DAG执行
- 查询队列状态（各级别任务数量）

## 项目结构

```
.
├── main.go                 # 主程序入口
├── go.mod                  # Go模块定义
├── config/
│   └── config.go          # 配置管理
├── models/
│   └── models.go          # 数据模型和数据库连接
├── queue/
│   └── redis.go           # Redis消息队列封装
├── scheduler/
│   ├── dag.go             # DAG解析和验证
│   └── scheduler.go       # 任务调度器
├── api/
│   └── handlers.go        # HTTP API处理器
├── worker/
│   └── pool.go            # Goroutine工作池
└── examples/
    └── dag_example.json   # DAG示例（10个任务）
```

## 环境要求

- Go 1.21+
- PostgreSQL 12+
- Redis 5+

## 快速开始

### 1. 安装依赖

```bash
go mod download
```

### 2. 配置环境变量

```bash
export POSTGRES_DSN="host=localhost user=postgres password=postgres dbname=scheduler port=5432 sslmode=disable"
export REDIS_ADDR="localhost:6379"
export SERVER_PORT=":8080"
```

### 3. 创建数据库

```sql
CREATE DATABASE scheduler;
```

### 4. 启动服务

```bash
go run main.go
```

## API使用

### 提交带优先级的DAG任务

```bash
curl -X POST http://localhost:8080/api/v1/dag \
  -H "Content-Type: application/json" \
  -d @examples/dag_with_priority.json
```

响应示例：
```json
{
  "dag_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "DAG submitted successfully"
}
```

### 任务优先级设置

在任务定义中添加`priority`字段：
```json
{
  "id": "task_1",
  "name": "关键任务",
  "type": "data_processing",
  "priority": "high", // high | medium | low
  "depends_on": []
}
```

### 查询DAG状态

```bash
curl http://localhost:8080/api/v1/dag/{dag_id}
```

### 列出所有DAG

```bash
curl http://localhost:8080/api/v1/dag
```

### 触发DAG执行

```bash
curl -X POST http://localhost:8080/api/v1/dag/trigger \
  -H "Content-Type: application/json" \
  -d '{"dag_id": "550e8400-e29b-41d4-a716-446655440000"}'
```

### 查询队列状态

```bash
curl http://localhost:8080/queue/status
```

响应示例：
```json
{
  "high_priority": 5,
  "medium_priority": 10,
  "low_priority": 3
}
```

### 健康检查

```bash
curl http://localhost:8080/health
```

## DAG任务定义说明

DAG示例包含10个任务，形成典型的机器学习工作流：

```
data_collect_1 ──> data_clean_1 ──> feature_extract_1 ──┐
                                                         ├─> feature_merge ──┬─> model_train_1 ──┐
data_collect_2 ──> data_clean_2 ──> feature_extract_2 ──┘                     │                   ├─> result_aggregation
                                                                               └─> model_train_2 ──┘
```

任务类型：
- data_collection: 数据采集
- data_cleaning: 数据清洗
- feature_extraction: 特征提取
- feature_merging: 特征合并
- model_training: 模型训练
- result_aggregation: 结果聚合

## 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| PostgresDSN | PostgreSQL连接串 | 本地默认连接 |
| RedisAddr | Redis地址 | localhost:6379 |
| ServerPort | HTTP服务端口 | :8080 |
| WorkerCount | 工作池大小 | 10 |
| MaxRetries | 最大重试次数 | 3 |

## 核心特性详解

### 依赖检查
- 任务执行前自动检查所有前置任务是否完成
- 只有所有依赖任务都完成后才会执行当前任务

### Redis Streams
- 使用消费者组模式
- 支持消息确认机制
- 确保消息不丢失

### 并发控制
- 使用信号量控制并发数
- 避免系统过载
- 可动态调整工作池大小

### 状态持久化
- 所有任务状态存储在PostgreSQL
- 支持系统重启后恢复
- 可追溯任务执行历史

## 扩展开发

### 添加新的任务类型
1. 在任务定义中指定新的type
2. 在外部服务中实现对应的处理逻辑
3. 配置任务endpoint

### 自定义重试策略
修改 `worker/pool.go` 中的 `handleTaskFailure` 函数：
- 调整重试间隔
- 实现指数退避
- 添加重试条件判断

### 集成监控
- 添加Prometheus指标
- 集成日志收集系统
- 实现告警机制

## License

MIT
