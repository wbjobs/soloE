# 分布式任务调度系统

基于Java Spring Boot + Redis + PostgreSQL开发的分布式任务调度系统

## 核心功能

### 1. 任务类型支持
- **HTTP调用**: 调用外部HTTP接口
- **Shell脚本执行**: 执行Shell命令和脚本
- **SQL查询**: 执行SQL查询

### 2. DAG任务依赖图
- 支持配置任务执行顺序依赖关系
- 例如: A完成后才能执行B和C，B和C都完成后执行D

### 3. Redis Streams任务队列
- 基于Redis Streams实现任务队列
- 支持任务分发机制
- 消费者组模式

### 4. Worker节点管理
- 自动注册
- 心跳检测
- 自动故障转移

### 5. 失败重试机制
- 指数退避算法
- 可配置最大重试次数

### 6. 优先级抢占
- 高优先级任务可中断低优先级任务
- 被中断任务重新入队

## 技术栈

- **Java 17**
- **Spring Boot 3.2**
- **Redis Streams (任务队列
- **PostgreSQL** (数据持久化)
- **Spring Data JPA**

## 快速开始

### 环境要求：
- JDK 17+
- Maven 3.8+
- Redis 6.0+
- PostgreSQL 14+

### 配置

修改 `src/main/resources/application.yml`

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/task_scheduler
    username: postgres
    password: postgres

  data:
    redis:
      host: localhost
      port: 6379
```

### 构建运行

```bash
# 构建
mvn clean package

# 运行
java -jar target/distributed-task-scheduler-1.0.0.jar
```

## API接口

### 任务管理

#### 提交任务
```
POST /api/tasks
Content-Type: application/json

{
  "taskName": "http-test",
  "type": "HTTP",
  "priority": "HIGH",
  "payload": "{\"url\":\"http://example.com/api\",\"method\":\"GET\"}",
  "maxRetries": 3
}
```

#### 查询任务状态
```
GET /api/tasks/{taskId}
```

#### 抢占任务
```
POST /api/tasks/{taskId}/preempt
```

### DAG管理

#### 创建DAG
```
POST /api/dags
Content-Type: application/json

{
  "name": "my-workflow",
  "description": "A -> B, A -> C, B -> D, C -> D"
}
```

#### 添加依赖边
```
POST /api/dags/{dagId}/edges
Content-Type: application/json

{
  "fromTask": "A",
  "toTask": "B"
}
```

#### 提交DAG任务
```
POST /api/dags/{dagId}/submit
Content-Type: application/json

[
  {
    "taskName": "A",
    "type": "HTTP",
    "priority": "HIGH",
    "payload": "..."
  },
  {
    "taskName": "B",
    "type": "SHELL",
    "priority": "MEDIUM",
    "payload": "..."
  }
]
```

### Worker管理

#### 查询所有Worker
```
GET /api/workers
```

## 任务Payload格式

### HTTP任务
```json
{
  "url": "http://example.com/api",
  "method": "GET",
  "body": "request body",
  "headers": {
    "Content-Type": "application/json"
  }
}
```

### Shell任务
```json
{
  "command": "echo",
  "arguments": ["hello", "world"],
  "workingDirectory": "/tmp",
  "timeout": 30000
}
```

### SQL任务
```json
{
  "jdbcUrl": "jdbc:postgresql://localhost:5432/test",
  "username": "user",
  "password": "pass",
  "sql": "SELECT * FROM users"
}
```

## 项目结构

```
src/main/java/com/scheduler/
├── TaskSchedulerApplication.java    # 启动类
├── config/                           # 配置类
│   ├── RedisConfig.java
│   └── SchedulerProperties.java
├── controller/                       # REST API
│   ├── DAGController.java
│   ├── TaskController.java
│   └── WorkerController.java
├── dto/                            # 数据传输对象
│   ├── ApiResponse.java
│   ├── DAGEdgeRequest.java
│   ├── DAGRequest.java
│   └── TaskRequest.java
├── entity/                         # JPA实体
│   ├── DAG.java
│   ├── DAGEdge.java
│   ├── TaskInstance.java
│   └── WorkerNode.java
├── enums/                          # 枚举类型
│   ├── TaskPriority.java
│   ├── TaskStatus.java
│   ├── TaskType.java
│   └── WorkerStatus.java
├── exception/                      # 异常处理
│   └── GlobalExceptionHandler.java
├── repository/                     # 数据访问层
│   ├── DAGEdgeRepository.java
│   ├── DAGRepository.java
│   ├── TaskInstanceRepository.java
│   └── WorkerNodeRepository.java
├── service/                        # 业务逻辑
│   ├── DAGService.java
│   ├── PreemptionService.java
│   ├── RetryService.java
│   ├── TaskCompletionListener.java
│   ├── TaskExecutionService.java
│   ├── TaskQueueService.java
│   └── WorkerRegistryService.java
└── task/                           # 任务执行器
    ├── HttpTaskExecutor.java
    ├── ShellTaskExecutor.java
    ├── SqlTaskExecutor.java
    └── TaskExecutor.java
```
