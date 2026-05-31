# 文本生成任务处理系统

一个基于FastAPI和Redis的异步任务处理系统，用于模拟耗时的AI文本生成任务。

## 项目结构

```
e27/
├── api/                    # FastAPI API服务目录
│   ├── __init__.py
│   └── main.py            # API端点实现
├── worker/                 # 任务处理工作进程目录
│   ├── __init__.py
│   └── main.py            # 工作进程实现
├── config.py              # 配置文件
├── redis_utils.py         # Redis工具函数
├── requirements.txt       # Python依赖包
├── .env                   # 环境变量
└── README.md
```

## 功能特性

- **POST /tasks**: 接收文本提示，创建任务并立即返回task_id
- **GET /tasks/{task_id}**: 查询任务状态（pending/processing/finished）和结果
- **GET /tasks/{task_id}/stream**: SSE流式输出，实时接收生成的文本内容
- 基于Redis的消息队列实现任务异步处理
- 工作进程独立运行，逐字生成并发布结果
- **任务可靠性保证**: 工作进程崩溃或重启时，未完成的任务会自动重新入队处理

## 前置要求

- Python 3.8+
- Redis 服务器

## 安装步骤

1. 安装Python依赖：

```bash
pip install -r requirements.txt
```

2. 确保Redis服务器正在运行（默认 localhost:6379）

3. 配置环境变量（可选）：

编辑 `.env` 文件修改Redis连接配置。

## 运行方式

### 1. 启动API服务

```bash
python -m api.main
```

API服务将在 http://localhost:8000 启动。

### 2. 启动工作进程

在另一个终端中运行：

```bash
python -m worker.main
```

## API使用示例

### 创建任务

```bash
curl -X POST "http://localhost:8000/tasks" \
     -H "Content-Type: application/json" \
     -d '{"prompt": "写一首关于春天的诗"}'
```

响应：
```json
{
  "task_id": "a1b2c3d4-...",
  "status": "pending",
  "result": null
}
```

### 查询任务状态

```bash
curl "http://localhost:8000/tasks/{task_id}"
```

响应（待处理）：
```json
{
  "task_id": "a1b2c3d4-...",
  "status": "pending",
  "result": null
}
```

响应（处理中）：
```json
{
  "task_id": "a1b2c3d4-...",
  "status": "processing",
  "result": null
}
```

响应（已完成）：
```json
{
  "task_id": "a1b2c3d4-...",
  "status": "finished",
  "result": "AI生成结果: 基于提示 '写一首关于春天的诗' 生成的文本内容。这是模拟耗时操作后的结果。"
}
```

### API文档

启动API服务后，访问 http://localhost:8000/docs 查看Swagger UI文档。

## 技术栈

- **FastAPI**: Web框架，提供RESTful API和SSE流式响应
- **Redis**: 消息队列、任务结果存储、Pub/Sub实时通信
- **Uvicorn**: ASGI服务器
- **Pydantic**: 数据验证
- **SSE (Server-Sent Events)**: 服务器推送流式数据到客户端

## 工作流程

1. 客户端发送POST请求到 `/tasks`，包含文本提示
2. API服务生成唯一task_id，将任务存入Redis队列和结果存储
3. API立即返回task_id给客户端
4. 工作进程从Redis队列获取任务，原子地移入"processing"列表，更新状态为"processing"
5. 工作进程逐字生成文本结果，通过Redis Pub/Sub发布每个字符
6. API服务订阅任务的Pub/Sub通道，通过SSE实时推送给客户端
7. 生成完成后，工作进程更新任务状态为"finished"，并从"processing"列表移除任务
8. 客户端可以通过轮询 `/tasks/{task_id}` 获取最终结果，或通过 `/tasks/{task_id}/stream` 实时接收流式输出

## 流式输出架构

系统实现了类似ChatGPT的实时流式输出效果：

1. **工作进程**: 逐字生成文本，每个字符通过Redis Pub/Sub发布到任务专属通道
2. **API服务**: 订阅对应任务的Redis通道，使用SSE保持长连接，实时推送字符到客户端
3. **客户端**: 接收SSE数据流，逐字渲染显示，直到收到`[DONE]`标记
4. **任务完成**: 已完成任务直接返回完整结果，无需等待

## 任务可靠性机制

系统实现了任务处理的可靠性保证，防止工作进程崩溃导致任务丢失：

1. **任务获取原子操作**: 工作进程获取任务时，任务从待处理队列移入"processing"列表，不会丢失
2. **启动恢复机制**: 工作进程启动时，自动检查"processing"列表中的任务并重新入队
3. **异常处理**: 任务处理过程中发生异常时，任务会自动重新入队等待再次处理
4. **持久化存储**: 所有任务状态和processing列表都持久化存储在Redis中
