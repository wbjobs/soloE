# RUDP - 基于UDP的可靠传输协议

这是一个用Rust实现的基于UDP的可靠传输协议，类似QUIC的精简版本，实现了连接管理、丢包重传、流量控制和拥塞控制。

## 功能特性

### 1. 连接建立（1-RTT握手）
- 采用简化的握手流程，支持1-RTT建立连接
- 使用SYN、SYN-ACK、ACK报文进行连接协商
- 支持连接关闭机制（FIN、FIN-ACK）

### 2. 丢包重传（基于自适应RTT估算）
- 实现了经典的Jacobson/Karels算法进行RTT平滑估算
- **Karn算法**: 重传的数据包不用于RTT更新，避免估算偏差
- 每个数据包独立的指数退避RTO计算
- RTO最小值200ms，最大值60s
- 最大重试次数15次，避免永久重传
- 累计确认（Cumulative Acknowledgments）

### 3. 乱序重排（内存安全）
- 接收端支持乱序数据包的缓存和重排
- 基于内存使用的流量控制，默认10MB上限
- 空洞大小限制，避免过大的内存空洞
- 最大1000个序列号的空洞保护
- 旧数据包自动清理机制
- 按序交付给应用层

### 4. 流量控制（滑动窗口）
- 发送端滑动窗口管理
- 接收端窗口通告机制
- 基于对端接收能力的流量控制
- 在途包数量限制（默认1000个）

### 5. 拥塞控制（NewReno + Pacing）
- 慢启动（Slow Start）阶段
- 拥塞避免（Congestion Avoidance）阶段
- 快速重传/快速恢复，带冷却时间（避免拥塞崩溃）
- 超时后重置拥塞窗口
- **发送Pacing**: 避免发送突发导致网络拥塞
- 重传队列限制，防止高丢包下重传风暴

## 高丢包环境稳定性修复（v2）

### 问题1：拥塞崩溃（高丢包吞吐量归零）
**修复方案：**
- 新增发送Pacing机制，平滑发送速率
- 重传队列长度限制（基于当前cwnd）
- 恢复状态冷却时间，避免频繁进入快速恢复
- 最大在途包数量限制
- 每次超时仅重传部分数据包（而非全部）

### 问题2：RTT估算不准导致误重传
**修复方案：**
- 实现Karn算法：重传包不用于RTT更新
- 每个包独立计算RTO（指数退避）
- RTO上下限保护（200ms-60s）
- 重传时保守更新RTT估计值

### 问题3：乱序Buffer内存泄漏/OOM
**修复方案：**
- 接收窗口最大内存限制（默认10MB）
- 最大序列号空洞限制（1000）
- 内存不足时拒绝接收新包
- 窗口大小通告同时考虑数量和内存

## 高级功能（v3）

### 1. 多路复用（Multi-Streaming）
**功能说明：** 类似QUIC的流多路复用，在单个连接上可以并行传输多个独立的数据流。

**核心特性：**
- 每个流拥有独立的序列号和流控窗口
- 一个流的丢包不会阻塞其他流的传输
- 流级别流量控制
- 最多支持100个并发流
- 客户端和服务器端流ID分配

**使用场景：**
- 并行下载多个文件
- 同时传输控制消息和数据
- 不同优先级数据流分离

**使用示例：**
```bash
# 同时发送多个文件（每个文件一个流）
cargo run -- send-files --addr 127.0.0.1:8080 --files file1.txt file2.txt file3.txt
```

---

### 2. 0-RTT会话恢复
**功能说明：** 使用会话票证（Session Ticket）实现0-RTT握手，在连接建立的第一个RTT就可以发送应用数据。

**核心特性：**
- 会话票证序列化/反序列化
- 加密参数存储（简化版）
- 流状态恢复
- 首次SYN包中即可携带应用数据

**使用场景：**
- 移动网络快速重连
- HTTP/3风格的快速请求
- 减少握手延迟

**使用示例：**
```bash
# 第一次连接，保存会话票证
cargo run -- session-resume --addr 127.0.0.1:8080 --ticket ticket.bin

# 使用票证快速恢复连接，并发送数据
cargo run -- session-resume --addr 127.0.0.1:8080 --ticket ticket.bin --data test.txt
```

---

### 3. 连接迁移（Connection Migration）
**功能说明：** 在客户端或服务器IP/端口变化时，无需重新建立连接即可继续传输。

**核心特性：**
- 基于连接ID（CID）的连接识别
- 8字节随机生成的CID
- 路径挑战/响应机制（Path Challenge/Response）
- 多路径同时支持

**使用场景：**
- WiFi → 蜂窝网络切换
- 服务器负载均衡迁移
- NAT重绑定时保持连接

**使用示例：**
```bash
# 测试连接迁移（需要两个服务器端口）
cargo run -- migrate --addr 127.0.0.1:8080 --new-addr 127.0.0.1:8081
```

---

### 4. 详细传输指标统计
**功能说明：** 完整的性能监控和诊断功能。

**统计指标包括：**
- **拥塞控制指标**：CWND变化曲线、在途包数量、拥塞状态
- **RTT统计**：最小/最大/平均/Smoothed RTT
- **丢包统计**：超时丢包、快速重传、重复ACK数量
- **吞吐量统计**：实时和平均传输速率
- **流级别统计**：每个流的发送/接收字节数、重传次数

**使用示例：**
```bash
# 运行统计测试，每秒输出一次状态
cargo run -- stats --addr 127.0.0.1:8080 --seconds 10
```

**输出示例：**
```
=== 传输统计摘要 ===
连接时长: 10.02s
总发送: 500.00 MB (3571 包)
总接收: 498.50 MB (3565 包)
平均吞吐量: 49.90 MB/s

RTT统计:
  最小: 1.23ms
  最大: 8.56ms
  平均: 3.45ms
  最新: 2.89ms

丢包/重传:
  超时次数: 3
  快速重传: 12
  重复ACK: 36
  重传率: 0.42%
  丢包率: 0.34%

高级特性:
  0-RTT接受: 是
  连接迁移次数: 1

活跃流: 3 个
  流 0: 发送 150 MB, 接收 0 字节
  流 2: 发送 175 MB, 接收 0 字节
  流 4: 发送 175 MB, 接收 0 字节
```

---

## 项目结构

```
src/
├── lib.rs          # 库入口
├── packet.rs       # 数据包结构、CID、会话票证
├── connection.rs   # 连接管理核心逻辑
├── congestion.rs   # NewReno拥塞控制 + Pacing
├── rtt.rs          # RTT估算（含Karn算法）
├── window.rs       # 滑动窗口（内存保护）
├── stream.rs       # 流管理（多路复用）
├── metrics.rs      # 传输指标统计
└── main.rs         # 命令行工具
```

## 命令行工具

### 服务器模式

启动RUDP服务器：
```bash
cargo run -- server --addr 127.0.0.1:8080
```

启动TCP服务器（用于对比）：
```bash
cargo run -- server --addr 127.0.0.1:8080 --tcp
```

### 客户端模式

发送文件（RUDP）：
```bash
cargo run -- client --addr 127.0.0.1:8080 send --file test.bin
```

发送文件（TCP）：
```bash
cargo run -- client --addr 127.0.0.1:8080 --tcp send --file test.bin
```

### 压测模式

RUDP压测：
```bash
cargo run -- benchmark --addr 127.0.0.1:8080 --seconds 10
```

TCP压测：
```bash
cargo run -- benchmark --addr 127.0.0.1:8080 --seconds 10 --tcp
```

### 协议对比

自动对比RUDP和TCP的性能：
```bash
cargo run -- compare --addr 127.0.0.1:8080 --seconds 10
```

## 协议设计

### 数据包格式

```
+----------------+----------------+----------------+
| Packet Type    |  1 byte        |
+----------------+----------------+----------------+
| Sequence Num   |  4 bytes       |
+----------------+----------------+----------------+
| Ack Num        |  4 bytes       |
+----------------+----------------+----------------+
| Window Size    |  4 bytes       |
+----------------+----------------+----------------+
| Payload Len    |  4 bytes       |
+----------------+----------------+----------------+
| Payload        |  variable      |
+----------------+----------------+----------------+
```

### 数据包类型

- `Syn` (0): 连接请求
- `SynAck` (1): 连接响应
- `Ack` (2): 确认报文
- `Data` (3): 数据报文
- `Fin` (4): 关闭连接
- `FinAck` (5): 关闭响应

## 核心算法

### RTT估算（Jacobson/Karels算法）

```
SRTT = SRTT * (1 - α) + RTT_sample * α
RTTVAR = RTTVAR * (1 - β) + |RTT_sample - SRTT| * β
RTO = SRTT + 4 * RTTVAR
```

其中α = 1/8, β = 1/4

### NewReno拥塞控制

1. **慢启动阶段**: 每个ACK使cwnd += 1（指数增长）
2. **拥塞避免阶段**: 每个RTT使cwnd += 1（线性增长）
3. **丢包处理**:
   - 超时: cwnd = 1, ssthresh = cwnd/2, 进入慢启动
   - 3个重复ACK: 快速重传, ssthresh = cwnd/2, cwnd = ssthresh + 3

## 使用示例

### 基本用法

```rust
use rudp::{dial, listen};
use std::net::SocketAddr;

// 服务端
let addr: SocketAddr = "127.0.0.1:8080".parse()?;
let mut listener = listen(addr).await?;
while let Some(mut conn) = listener.recv().await {
    conn.wait_ack().await?;
    // 处理连接...
}

// 客户端
let mut conn = dial(addr).await?;
conn.send(b"Hello RUDP!").await?;
conn.flush().await?;
```

## 性能对比

在理想网络条件下：
- RUDP连接建立延迟更低（1-RTT vs TCP的3-RTT）
- 丢包恢复更快（NewReno快速重传）
- 吞吐量与TCP相当或略高

在有丢包的网络中：
- RUDP拥塞控制表现更好
- 更快的恢复和更稳定的吞吐量

## 注意事项

1. 本实现为教育演示用途，生产环境建议使用成熟的QUIC实现（如quinn）
2. 当前实现不支持真实加密（Session Ticket为简化实现）
3. 缺少流量控制的细粒度调整
4. 连接迁移需要应用层配合（多端口监听）

## 已实现的高级特性

- ✅ 多路复用（流级别窗口和流量控制）
- ✅ 0-RTT会话恢复（Session Ticket）
- ✅ 连接迁移（CID + 路径验证）
- ✅ 详细传输指标统计（CWND、RTT、丢包率）
- ✅ 发送Pacing（平滑发送速率）
- ✅ Karn算法RTT估算
- ✅ 接收窗口内存保护

## 未来改进方向

- 添加真实TLS 1.3加密支持
- BBR/BBRv2拥塞控制支持
- 更精确的定时器管理（TFO + RACK）
- 前向纠错（FEC）支持
- 多路径并发传输（MPQUIC风格）
- 更完善的流控和拥塞信号处理
- 接收端卸载优化（GRO/LRO）
