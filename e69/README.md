# 🚀 WASI 分布式调度器

基于 Rust + Wasmtime 的企业级 WASI 模块调度系统，支持分布式多节点协同、DAG 工作流编排、资源限制保护和实时 Web 监控界面。

## ✨ 核心特性

### 1. 分布式调度 (ClusterManager)
- **多节点协调**: 支持主从架构，工作节点自动注册和心跳检测
- **智能负载均衡**: 基于内存、CPU、任务数的智能调度
- **动态扩缩容**: 运行时添加/移除工作节点
- **节点健康监控**: 自动检测和隔离故障节点

### 2. DAG 工作流编排 (DAGManager)
- **有向无环图**: 支持复杂任务依赖关系
- **任务编排**: 任务自动按依赖顺序执行
- **循环检测**: 自动检测并拒绝循环依赖
- **进度追踪**: 实时工作流完成度统计
- **状态管理**: 完整的任务状态机 (Pending/Running/Completed/Failed/Cancelled)

### 3. Web 管理界面
- **实时仪表盘**: 集群状态、任务数、内存使用一目了然
- **工作流管理**: 创建、启动、取消工作流，添加任务
- **模块管理**: WASI 模块的加载/卸载和优先级配置
- **性能指标**: 执行次数、成功率、平均耗时等统计
- **集群监控**: 各节点状态、资源使用情况

### 4. IPC 共享内存通信
- **无锁环形缓冲区**: 高性能消息传递
- **有序消息队列**: 序列号保证消息顺序
- **多区域支持**: 独立的共享内存区域隔离
- **边界检查**: 防止内存越界访问

### 5. 资源限制保护
- **内存限制**: Wasmtime StoreLimiter 监控内存增长
- **CPU 时间**: 任务超时自动终止
- **文件描述符**: 限制最大打开文件数
- **优先级队列**: Critical/High/Normal/Low 四级优先级

### 6. 并发安全保障
- **无锁设计**: 关键路径使用原子操作
- **锁顺序保证**: 避免死锁的严格锁获取顺序
- **通道通信**: crossbeam-channel 替代 Mutex 进行线程通信

## 🏗️ 项目结构

```
wasi-scheduler/
├── src/
│   ├── lib.rs              # 库入口，导出所有模块
│   ├── main.rs             # 主程序入口
│   ├── config.rs           # 配置和资源限制定义
│   ├── error.rs            # 错误类型和处理
│   ├── module.rs           # WASI 模块管理器
│   ├── scheduler.rs        # 核心调度器 + 任务队列
│   ├── cluster.rs          # 分布式集群管理
│   ├── dags.rs             # DAG 工作流编排
│   ├── ipc.rs              # 共享内存 IPC 系统
│   ├── metrics.rs          # 性能指标采集 (无锁原子操作)
│   └── webserver.rs        # Axum Web 服务器 + REST API
├── static/
│   ├── index.html          # Web 界面 HTML
│   ├── styles.css          # 现代深色主题样式
│   └── app.js              # 前端交互逻辑
└── Cargo.toml              # 依赖配置
```

## 🚀 快速开始

### 前置要求
- Rust 1.70+ (https://www.rust-lang.org/tools/install)

### 编译运行

```bash
# 克隆项目
cd wasi-scheduler

# 编译并运行
cargo run

# 或者以 release 模式运行
cargo run --release
```

启动后访问: **http://localhost:8080**

## 📡 REST API 文档

### 健康检查
```
GET /api/health
```

### 模块管理
```
GET    /api/modules              # 列出所有模块
POST   /api/modules              # 加载新模块
DELETE /api/modules/:id          # 卸载模块
```

### 工作流管理
```
GET    /api/workflows            # 列出所有工作流
GET    /api/workflows/:id        # 获取工作流详情
POST   /api/workflows            # 创建工作流
POST   /api/workflows/:id/start  # 启动工作流
POST   /api/workflows/:id/cancel # 取消工作流
POST   /api/workflows/:id/tasks  # 添加任务到工作流
```

### 集群管理
```
GET    /api/cluster/stats        # 集群统计信息
GET    /api/cluster/workers      # 工作节点列表
```

### 指标监控
```
GET    /api/metrics/execution    # 执行指标
GET    /api/metrics/queue        # 队列指标
```

## 🎯 核心数据结构

### Task (任务)
```rust
pub struct Task {
    pub id: String,
    pub module: WasiModule,
    pub priority: Priority,
    pub submitted_at: Instant,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}
```

### DAGWorkflow (工作流)
```rust
pub struct DAGWorkflow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub tasks: Vec<DAGTask>,
    pub status: TaskStatus,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}
```

### WorkerNode (工作节点)
```rust
pub struct WorkerNode {
    pub id: String,
    pub name: String,
    pub address: String,
    pub status: NodeStatus,
    pub cpu_cores: usize,
    pub total_memory_mb: usize,
    pub available_memory_mb: usize,
    pub running_tasks: usize,
    pub max_tasks: usize,
    pub last_heartbeat: DateTime<Utc>,
}
```

## 🔧 资源限制配置

```rust
ResourceLimits {
    max_cpu_time_ms: 30000,     // 单任务最大 CPU 时间 (ms)
    max_memory_bytes: 512<<20,  // 单任务最大内存 (512MB)
    max_file_descriptors: 128,  // 单任务最大 FD 数量
}
```

## 📊 性能指标

系统实时采集以下指标:
- **执行指标**: 总执行次数、成功/失败次数、平均/最小/最大执行时间
- **队列指标**: 当前队列长度、峰值长度、总入队/出队次数
- **集群指标**: 在线节点数、繁忙节点数、总运行任务、可用内存

## 🎨 Web 界面预览

界面采用现代深色主题设计，包含:
- 📊 仪表盘: 实时状态卡片 + 数据可视化
- 🖥️ 集群管理: 工作节点表格，状态、资源一目了然
- ⚙️ 工作流编排: 卡片式工作流展示，进度条可视化
- 📦 模块管理: 优先级标记，一键加载/卸载
- 📈 指标监控: 详细的性能统计数据

## 🛡️ 安全特性

1. **内存隔离**: 每个 WASI 实例运行在独立 Store
2. **资源配额**: 硬限制防止恶意/失控代码
3. **超时保护**: 任务超时自动终止
4. **IPC 隔离**: 共享内存区域按名称隔离
5. **并发安全**: 所有共享结构 Send + Sync 保证

## 📝 开发计划

- [ ] gRPC 节点间通信协议实现
- [ ] 工作流持久化存储 (SQLite/PostgreSQL)
- [ ] 任务重试和失败回退机制
- [ ] Prometheus + Grafana 指标对接
- [ ] WebSocket 实时推送更新
- [ ] 模块热重载支持
- [ ] 自动伸缩策略配置

## 📄 许可证

MIT License - 详见 LICENSE 文件

---

**🚀 用 Rust 的安全性和性能，构建下一代 WASI 调度平台！**
