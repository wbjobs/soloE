# 故障转移测试指南

## 测试场景

本指南描述了如何测试客户端突然断开（kill -9）时的故障转移机制。

## 架构改进

### 协调服务端改进

1. **快速连接断开检测**：
   - 使用 `conn.closed().await` 监听 QUIC 连接关闭
   - 连接断开后立即将节点标记为 `is_connected = false`
   - 无需等待心跳超时即可检测到故障

2. **心跳优化**：
   - 默认心跳间隔从 10 秒改为 **5 秒**
   - 节点超时时间从 30 秒改为 **10 秒**（2 倍心跳间隔）

3. **Get 时主动故障转移**：
   - 每次查询时检查所有者节点是否在线
   - 如果节点离线，立即尝试重新分配给其他存活节点
   - 重新分配后版本号递增

4. **新响应类型**：
   - `OwnerUnavailable { key }`：所有者离线且无其他存活节点可分配

### 客户端改进

1. **自动重试**：
   - `get` 命令支持 `--max-retries` 参数（默认 3 次）
   - 遇到 `OwnerUnavailable` 时自动重试，带指数退避

2. **P2P 直连 + 自动回退**：
   - 新增 `get-direct` 命令，优先尝试直连持有者节点
   - 直连失败时自动回退到协调服务查询
   - 协调服务会自动触发故障转移

3. **本地缓存**：
   - 缓存键的所有者信息，减少协调服务查询
   - 直连失败时自动失效缓存

## 测试步骤

### 准备环境

```bash
# 1. 生成证书
bash scripts/gen_certs.sh  # 或 Windows: .\scripts\gen_certs.ps1

# 2. 编译
cargo build --release
```

### 测试 1：优雅断开后的故障转移

```bash
# Terminal 1: 启动协调服务
cargo run --release -p coordinator -- --heartbeat-interval 5 --node-timeout 10

# Terminal 2: 启动节点 A (持有者)
cargo run --release -p client -- --node-id node-a daemon --address 127.0.0.1:9001

# Terminal 3: 启动节点 B (备用)
cargo run --release -p client -- --node-id node-b daemon --address 127.0.0.1:9002

# Terminal 4: 注册并写入数据
cargo run --release -p client -- --node-id node-a register --address 127.0.0.1:9001
cargo run --release -p client -- --node-id node-a put test-key "test-value" --ttl 600

# 验证数据
cargo run --release -p client -- get test-key
# 应该看到 owner: node-a

# 优雅关闭节点 A (Ctrl+C)
# 等待约 5-10 秒

# 再次查询
cargo run --release -p client -- get test-key
# 应该看到 owner: node-b (自动故障转移!)
```

### 测试 2：强制断开（kill -9）后的故障转移

```bash
# Terminal 1: 启动协调服务
cargo run --release -p coordinator -- --heartbeat-interval 5 --node-timeout 10

# Terminal 2: 启动节点 A
cargo run --release -p client -- --node-id node-a daemon --address 127.0.0.1:9001
# 记录进程 PID

# Terminal 3: 启动节点 B
cargo run --release -p client -- --node-id node-b daemon --address 127.0.0.1:9002

# Terminal 4: 写入数据
cargo run --release -p client -- --node-id node-a put test-key "test-value" --ttl 600

# 强制 kill 节点 A
kill -9 <pid-of-node-a>  # Windows: 任务管理器结束进程

# 立即查询 (在 1 秒内)
cargo run --release -p client -- get test-key
# 协调服务检测到连接已关闭，立即触发故障转移
# 应该看到 owner: node-b
```

### 测试 3：无存活节点的情况

```bash
# 只启动一个节点并写入数据，然后 kill 它
# 不启动其他备用节点

# 查询时会收到:
# Error: Owner for key 'test-key' is unavailable and no failover target exists
```

### 测试 4：P2P 直连 + 自动回退

```bash
# 启动协调服务和两个节点
# 写入数据到节点 A

# 使用 get-direct 命令
cargo run --release -p client -- get-direct test-key --max-retries 3
# 第一次查询会从协调服务获取数据并缓存所有者信息

# 再次查询
cargo run --release -p client -- get-direct test-key
# 优先尝试 P2P 直连节点 A，如果成功直接返回缓存值
# 如果失败（节点 A 已死），自动回退到协调服务，触发故障转移
```

## 预期行为

| 场景 | 检测延迟 | 行为 |
|------|----------|------|
| 优雅断开 (Ctrl+C) | < 1 秒 | QUIC 连接关闭立即被检测到，标记节点离线，下次 Get 触发故障转移 |
| 强制断开 (kill -9) | < 1 秒 | 操作系统关闭 TCP 连接，QUIC 检测到，立即触发 |
| 网络分区 (静默断开) | 10 秒 | 心跳超时后检测到，后台任务执行故障转移 |
| Get 时所有者离线 | 0 秒 | 查询时主动检测并立即重新分配 |

## 性能影响

- **正常情况**：无额外开销，Get 操作 < 1ms
- **故障转移时**：首次 Get 会有约 5-10ms 的额外延迟（重新分配）
- **后续请求**：恢复正常性能

## 日志观测

协调服务会输出以下日志：

```
# 节点断开
WARN coordinator: Node node-a marked as disconnected
INFO coordinator: Node node-a disconnected due to connection close

# 故障转移
WARN coordinator: Key test-key owner node-a is offline, attempting failover
INFO coordinator: Failing over key test-key from node-a to node-b
```
