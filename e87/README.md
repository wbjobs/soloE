# QUIC 内存协调服务

基于 QUIC 协议的分布式内存协调服务，支持远程内存块的注册、查询、更新和故障转移。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                     Coordinator                         │
│  (Rust + Actix-web + Quinn QUIC)                        │
│  - 维护内存块元数据 (节点地址、TTL、版本号)              │
│  - 故障转移：持有者离线时自动重新分配                    │
│  - 支持 QUIC 0-RTT 和 1-RTT                            │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │ QUIC 协议               │ QUIC 协议
┌───────▼──────────┐    ┌────────▼──────────┐
│   Client A       │    │   Client B        │
│ (Rust CLI)       │    │ (Rust CLI)        │
│ - 注册节点       │    │ - 注册节点        │
│ - Put/Get/Update │    │ - Put/Get/Update  │
│ - 心跳维持       │    │ - 心跳维持        │
└──────────────────┘    └───────────────────┘
```

## 功能特性

- ✅ **QUIC 传输**：使用 Quinn 实现，支持 0-RTT 和 1-RTT 握手
- ✅ **远程内存块**：Key-Value 存储，支持 TTL
- ✅ **元数据管理**：版本号、所有者节点、TTL、节点地址
- ✅ **版本控制与乐观锁 (CAS)**：
  - 版本号自动递增（创建时为 1，每次更新 +1）
  - 支持 Compare-And-Swap 条件更新 (`--cas` 模式)
  - 版本不匹配返回冲突详情（期望版本 vs 当前版本）
  - 冲突统计 API：总操作数、成功率、按 key 统计
- ✅ **快速故障转移**：
  - 连接断开立即检测（< 1 秒）
  - 心跳检测（每 5 秒）
  - 租约过期机制（10 秒超时）
  - Get 时主动检查并重新分配孤儿块
- ✅ **客户端自动重定向**：
  - P2P 直连 + 自动回退协调服务
  - 遇到 OwnerUnavailable 时自动重试（指数退避）
  - 本地缓存所有者信息
- ✅ **乐观并发控制**：基于版本号的更新检查
- ✅ **心跳机制**：客户端定期发送心跳维持在线状态
- ✅ **性能测试**：支持 1000+ ops/sec 的基准测试

## 编译

```bash
# 生成证书
bash scripts/gen_certs.sh

# 编译所有组件
cargo build --release
```

## 运行

### 1. 启动协调服务

```bash
cargo run --release -p coordinator -- \
  --listen 0.0.0.0:8080 \
  --cert certs/cert.pem \
  --key certs/key.pem
```

### 2. 运行客户端（守护进程模式）

```bash
# 客户端 A
cargo run --release -p client -- \
  --server 127.0.0.1:8080 \
  --node-id node-a \
  daemon --address 127.0.0.1:9001

# 客户端 B
cargo run --release -p client -- \
  --server 127.0.0.1:8080 \
  --node-id node-b \
  daemon --address 127.0.0.1:9002
```

### 3. 使用命令行操作

```bash
# 注册节点
cargo run --release -p client -- --node-id my-node register --address 127.0.0.1:9000

# 写入数据
cargo run --release -p client -- --node-id my-node put my-key "my-value" --ttl 300

# 读取数据
cargo run --release -p client -- get my-key

# 更新数据（需要指定版本号）
cargo run --release -p client -- --node-id my-node update my-key "new-value" --version 1

# 列出所有 key
cargo run --release -p client -- list

# 删除 key
cargo run --release -p client -- --node-id my-node delete my-key
```

### 4. 性能测试

```bash
# 运行基准测试：1000 ops/sec，持续 30 秒
cargo run --release -p bench -- \
  --server 127.0.0.1:8080 \
  --ops-per-sec 1000 \
  --duration-secs 30 \
  --connections 10 \
  --read-ratio 0.7
```

## 协议

所有消息使用 JSON 序列化，通过 QUIC 双向流传输。

### 请求类型

```rust
enum Request {
    Register { node_id, address },
    Put { key, value, ttl },
    Get { key },
    Update { key, value, version },
    CompareAndSwap { key, value, expected_version, new_ttl },  // CAS 更新
    Delete { key },
    ListKeys,
    Heartbeat { node_id },
    GetStats,                                                  // 获取统计信息
}
```

### 响应类型

```rust
enum Response {
    Ok,
    Value { key, value, version, owner, owner_address, ttl_remaining },
    KeyNotFound,
    KeyList(Vec<Key>),
    Registered,
    HeartbeatAck,
    VersionMismatch { current_version },
    Error(String),
}
```

## QUIC 0-RTT 支持

服务端配置了 `max_early_data_size = u32::MAX` 以支持 0-RTT。
客户端在后续连接中会自动使用 0-RTT 握手（由 Quinn 自动处理）。

## 故障转移机制

### 检测机制

1. **立即检测**：QUIC 连接关闭时立即标记节点离线（< 1 秒）
2. **心跳检测**：每个客户端定期（默认 5 秒）发送心跳
3. **租约过期**：节点 10 秒无心跳标记为离线（2 倍心跳间隔）

### 重新分配机制

1. **Get 时主动检查**：每次查询时检查所有者是否在线，离线则立即重新分配
2. **后台定期扫描**：后台任务每 5 秒扫描所有节点，批量重新分配
3. **版本递增**：重新分配的内存块版本号自动递增
4. **无存活节点**：返回 `OwnerUnavailable` 错误，客户端可自动重试

### 客户端自动重定向

1. **`get` 命令**：遇到 `OwnerUnavailable` 自动重试，带指数退避
2. **`get-direct` 命令**：优先 P2P 直连所有者，失败自动回退到协调服务
3. **本地缓存**：缓存所有者信息，减少协调服务查询压力
