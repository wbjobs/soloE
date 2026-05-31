# 轻量级分布式任务调度系统

基于 Python + Redis + RQ 实现的分布式任务调度系统，支持定时任务、任务依赖、任务重试和超时控制。

## 功能特性

- ✅ **定时任务**: 支持 cron 表达式配置定时执行
- ✅ **任务依赖**: 支持任务间依赖关系，B任务等待A任务完成后执行
- ✅ **循环依赖检测**: 提交任务时自动检测依赖链循环，防止死锁，返回冲突路径
- ✅ **任务分片 (MapReduce)**: 支持大任务自动拆分为多个子任务并行执行，提供归并函数汇总结果
- ✅ **进度查询**: 支持查询分片任务的实时执行进度和各子任务状态
- ✅ **任务重试**: 失败任务自动重试，最多3次，采用指数退避策略
- ✅ **超时控制**: 支持任务超时设置，超时自动终止
- ✅ **持久化存储**: 所有任务元数据持久化到 PostgreSQL
- ✅ **RESTful API**: 提供 Flask API 接口管理任务

## 技术栈

- **Python 3.8+**
- **Flask** - Web API 框架
- **Redis** - 任务队列存储
- **RQ (Redis Queue)** - 任务队列库
- **RQ Scheduler** - 定时任务调度
- **PostgreSQL** - 任务元数据持久化
- **SQLAlchemy** - ORM框架
- **croniter** - cron 表达式解析

## 项目结构

```
.
├── app.py              # Flask API 服务
├── config.py           # 配置文件
├── models.py           # 数据库模型
├── task_queue.py       # 任务队列管理
├── task_worker.py      # 任务执行Worker
├── scheduler.py        # 定时任务调度器
├── tasks.py            # 示例任务函数
├── example.py          # API使用示例
├── requirements.txt    # Python依赖
├── .env               # 环境变量
└── README.md          # 项目说明
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 启动依赖服务

#### 启动 Redis
```bash
redis-server
```

#### 启动 PostgreSQL 并创建数据库
```bash
# 在 PostgreSQL 中创建数据库
CREATE DATABASE task_scheduler;
```

### 3. 配置环境变量

编辑 `.env` 文件，配置数据库连接信息：

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=task_scheduler
```

### 4. 启动服务

#### 启动 Worker（在单独的终端中）
```bash
rq worker --url redis://localhost:6379/0
```

#### 启动定时任务调度器（在单独的终端中）
```bash
python scheduler.py
```

#### 启动 Flask API 服务（在单独的终端中）
```bash
python app.py
```

### 5. 运行示例
```bash
python example.py
```

## API 接口文档

### 1. 提交任务

**POST** `/api/tasks`

请求体:
```json
{
  "name": "任务名称",
  "function_name": "模块名.函数名",
  "args": [参数1, 参数2],
  "kwargs": {"key": "value"},
  "queue_name": "default",
  "cron_expression": "*/5 * * * *",
  "depends_on": "parent_task_id",
  "max_retries": 3,
  "timeout": 3600
}
```

参数说明:
- `function_name`: 必填，要执行的函数路径（如 `tasks.example_task`）
- `cron_expression`: 可选，cron 表达式，设置后为定时任务
- `depends_on`: 可选，父任务ID，设置后等待父任务完成
- `max_retries`: 可选，最大重试次数，默认 3 次
- `timeout`: 可选，任务超时时间（秒），默认 3600 秒

### 2. 查询任务状态

**GET** `/api/tasks/{task_id}`

响应示例:
```json
{
  "id": "task-uuid",
  "name": "Example Task",
  "status": "completed",
  "result": "30",
  "created_at": "2024-01-01T00:00:00",
  "completed_at": "2024-01-01T00:00:02"
}
```

### 3. 取消任务

**DELETE** `/api/tasks/{task_id}`

响应示例:
```json
{
  "message": "Task cancelled successfully",
  "task": {...}
}
```

### 4. 查看任务执行历史

**GET** `/api/tasks/{task_id}/history?page=1&per_page=20`

响应示例:
```json
{
  "task_id": "task-uuid",
  "history": [
    {
      "status": "running",
      "execution_time": "2024-01-01T00:00:00"
    },
    {
      "status": "completed",
      "result": "30",
      "execution_time": "2024-01-01T00:00:02"
    }
  ],
  "total": 2
}
```

### 5. 列出所有任务

**GET** `/api/tasks?page=1&per_page=20&status=running`

参数:
- `status`: 可选，按状态过滤 (pending/queued/running/completed/failed/cancelled)

## 核心功能示例

### 1. 普通任务

```python
import requests

response = requests.post('http://localhost:5000/api/tasks', json={
    'name': '加法计算',
    'function_name': 'tasks.example_task',
    'args': [10, 20]
})
```

### 2. 依赖任务

```python
# 任务A
task_a = requests.post('http://localhost:5000/api/tasks', json={
    'name': '处理数据',
    'function_name': 'tasks.process_data',
    'args': [12345]
}).json()

# 任务B，依赖任务A完成
task_b = requests.post('http://localhost:5000/api/tasks', json={
    'name': '生成报告',
    'function_name': 'tasks.generate_report',
    'args': [12345],
    'depends_on': task_a['id']
}).json()
```

### 3. 定时任务

```python
# 每分钟执行一次
response = requests.post('http://localhost:5000/api/tasks', json={
    'name': '定时发送邮件',
    'function_name': 'tasks.send_email',
    'args': ['user@example.com', '报告', '内容'],
    'cron_expression': '*/1 * * * *'
})
```

### 4. 任务重试

```python
response = requests.post('http://localhost:5000/api/tasks', json={
    'name': '可能失败的任务',
    'function_name': 'tasks.flaky_task',
    'max_retries': 3  # 最多重试3次
})
```

重试策略:
- 第1次重试: 等待 2 秒
- 第2次重试: 等待 4 秒
- 第3次重试: 等待 8 秒

### 5. 分片任务 (MapReduce)

```python
import requests
import time
import json

# 提交分片任务
response = requests.post('http://localhost:5000/api/tasks', json={
    'id': 'sum_task_001',
    'name': '分布式求和任务',
    'function_name': 'tasks.sum_shard',
    'is_sharded': True,
    'shard_function': 'tasks.shard_data',
    'merge_function': 'tasks.merge_shard_results',
    'kwargs': {
        'numbers': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        'shard_size': 2
    }
})

# 查询任务进度
while True:
    progress = requests.get('http://localhost:5000/api/tasks/sum_task_001/progress').json()
    print(f"进度: {progress['progress_percent']}%")
    if progress['status'] in ['completed', 'failed']:
        break
    time.sleep(1)

# 获取最终结果
result = requests.get('http://localhost:5000/api/tasks/sum_task_001').json()
final_result = json.loads(result['result'])
print(f"总和: {final_result['total_sum']}")
```

**分片任务三要素:**

1. **shard_function**: 分片函数，将大任务拆分为多个子任务参数
2. **function_name**: 子任务执行函数，每个分片独立执行
3. **merge_function**: 归并函数，汇总所有子任务的结果

## Cron 表达式说明

```
* * * * *
│ │ │ │ │
│ │ │ │ └── 星期 (0-7, 0或7是周日)
│ │ │ └──── 月份 (1-12)
│ │ └────── 日期 (1-31)
│ └──────── 小时 (0-23)
└────────── 分钟 (0-59)
```

常用示例:
- `*/5 * * * *` - 每5分钟
- `0 * * * *` - 每小时
- `0 9 * * *` - 每天9点
- `0 9 * * 1-5` - 工作日9点

## 任务状态说明

- `pending`: 待处理，等待依赖任务完成
- `queued`: 已入队，等待执行
- `running`: 执行中
- `completed`: 已完成
- `failed`: 执行失败
- `cancelled`: 已取消

## 自定义任务

在 `tasks.py` 中添加你的任务函数:

```python
def my_custom_task(param1, param2):
    # 执行你的业务逻辑
    result = do_something(param1, param2)
    return result
```

然后通过 API 调用:
```json
{
  "name": "我的自定义任务",
  "function_name": "tasks.my_custom_task",
  "args": ["value1", "value2"]
}
```

## 注意事项

1. 确保 Redis 和 PostgreSQL 服务正常运行
2. Worker 需要在项目根目录启动，以便正确导入任务函数
3. 生产环境建议使用 Gunicorn 替代 Flask 开发服务器
4. 建议使用 Supervisor 或 systemd 管理 Worker 和调度器进程
5. 数据库连接信息等敏感配置建议使用环境变量管理

## 故障排查

### Worker 无法找到函数
- 确认 Worker 在项目根目录启动
- 确认函数路径正确（如 `tasks.example_task`）

### 定时任务不执行
- 确认 scheduler.py 正在运行
- 确认 cron 表达式格式正确
- 检查系统时间是否正确

### 数据库连接失败
- 确认 PostgreSQL 服务正在运行
- 检查 `.env` 中的数据库配置
- 确认数据库 `task_scheduler` 已创建
