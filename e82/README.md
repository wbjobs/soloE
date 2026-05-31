# 分布式调度系统 - 仲裁日志分析工具

基于 Raft 协议的仲裁日志可视化分析工具，支持脑裂检测和实时数据流分析。

## 项目结构

```
e82/
├── backend/          # Go + Gin 后端服务
│   ├── main.go       # 应用入口
│   ├── go.mod
│   ├── handlers/     # API 处理器
│   │   ├── simulate.go
│   │   ├── analyze.go
│   │   └── stream.go
│   ├── models/       # 数据模型
│   │   └── log.go
│   └── utils/        # 工具函数
│       └── generator.go
└── frontend/         # Vue3 + ECharts 前端
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.js
        └── App.vue
```

## 功能特性

1. **模拟数据生成**：生成符合 Raft 协议的仲裁日志（JSON Lines 格式）
2. **日志上传分析**：支持上传 JSONL 格式日志文件进行分析
3. **实时流式读取**：通过 SSE 实时接收并分析日志流
4. **桑基图可视化**：展示每个 Term 的投票分布情况
5. **脑裂检测**：自动检测并高亮显示存在脑裂风险的 Term
6. **仲裁合法性校验**：验证每个 Term 的选举是否合法

## API 接口

### GET /simulate
生成模拟仲裁日志

**参数：**
- `node_count`: 节点数量（默认: 3）
- `term_count`: Term 数量（默认: 10）
- `brain_split_rate`: 脑裂概率（默认: 0.2）

**响应：** JSON Lines 格式的日志流

### POST /analyze
分析仲裁日志，检测脑裂风险

**请求体：**
- 方式1: JSON 数组形式的日志数据
- 方式2: multipart/form-data 上传 .jsonl 文件

**响应：**
```json
{
  "terms": [...],
  "total_terms": 10,
  "brain_split_count": 2,
  "invalid_count": 0,
  "risk_terms": [3, 7]
}
```

### GET /stream
实时流式生成日志数据（SSE）

**参数：**
- `node_count`: 节点数量
- `interval`: 发送间隔（毫秒）
- `brain_split_rate`: 脑裂概率

## 快速开始

### 后端启动

```bash
cd backend
go mod tidy
go run main.go
```

后端服务运行在 http://localhost:8080

### 前端启动

```bash
cd frontend
npm install
npm run dev
```

前端服务运行在 http://localhost:5173

## 日志格式

每条日志采用 JSON Lines 格式，包含以下字段：

```json
{
  "term": 1,
  "vote_granted": true,
  "node_id": "A",
  "timestamp": 1715923456789
}
```

- `term`: 选举任期
- `vote_granted`: 是否授予选票
- `node_id`: 候选人节点 ID
- `timestamp`: 时间戳（毫秒）

## 脑裂检测逻辑

当一个 Term 中出现以下情况时判定为脑裂风险：
1. 多个节点同时获得选票
2. 没有节点获得超过半数的选票
3. 出现票数相同的多个领先者

风险等级：
- **critical**：存在脑裂风险
- **warning**：选举无效
- **normal**：正常选举
