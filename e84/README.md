# MQTT Load Tester

一个功能强大的 MQTT 负载测试工具，支持多客户端模拟、共享订阅（MQTT 5.0）、TLS 认证和实时 HTTP API 控制。

## 功能特性

- **多客户端模拟**: 可配置数量的 MQTT 客户端同时连接到 Broker
- **共享订阅支持**: MQTT 5.0 共享订阅 (`$share/group/topic`)
- **性能指标统计**:
  - 消息延迟（发布到接收的毫秒差）
  - 消息丢失率
  - 乱序率
  - 吞吐量（消息/秒）
  - 延迟百分位数（P50, P95, P99）
- **动态负载调整**: 通过 HTTP API 实时调整客户端数量和发布速率
- **TLS 支持**: 支持双向 TLS 认证
- **用户名密码认证**: 支持 MQTT 用户名密码认证
- **CSV 报告**: 生成详细的测试报告
- **控制台输出**: 实时显示测试进度和统计数据
- **Worker Pool 并发控制**: 限制最大并发连接数，防止大规模客户端时 OOM
- **内存监控**: 实时监控内存使用情况，自动输出内存统计
- **优雅退出**: 支持 SIGINT/SIGTERM 信号，安全断开所有客户端连接
- **单调时钟计时**: 避免系统时间调整导致负延迟统计
- **Broker 故障注入**: 通过 HTTP API 模拟 Broker 断连，测试共享订阅重新分配行为
- **重连行为统计**: 统计重连时间、消息重复数、未确认消息数
- **Web Dashboard**: 实时监控页面，展示延迟和吞吐量趋势折线图

## 项目结构

```
mqtt-load-tester/
├── main.go                 # 程序入口
├── cmd/
│   ├── root.go            # Cobra 根命令
│   └── run.go             # Run 命令实现
├── internal/
│   ├── config/            # 配置管理
│   │   └── config.go
│   ├── mqtt/              # MQTT 客户端管理
│   │   ├── client_manager.go
│   │   └── tls.go
│   ├── stats/             # 统计模块
│   │   └── stats.go
│   ├── report/            # 报告生成
│   │   └── csv.go
│   └── server/            # HTTP API 服务
│       └── server.go
├── config.yaml            # 示例配置文件
├── go.mod
└── README.md
```

## 构建

```bash
go build -o mqtt-load-tester .
```

## 快速开始

### 1. 准备配置文件

复制 `config.yaml` 并根据需要修改：

```yaml
broker:
  host: localhost
  port: 1883
  protocol: tcp
  username: ""
  password: ""
  tls:
    enabled: false
    cert_file: ""
    key_file: ""
    ca_file: ""
    insecure_skip_verify: false

clients:
  count: 10
  connect_timeout: 10s
  keep_alive: 60s
  client_id_prefix: "load-tester"

topics:
  base_topic: "test/load"
  share_group: "load-test-group"
  use_share_sub: true
  qos: 1

testing:
  duration: 60s
  message_size: 100
  publish_rate: 10
  warmup_period: 5s

http_server:
  enabled: true
  host: 0.0.0.0
  port: 8080

output:
  csv_file: "mqtt_load_test_report.csv"
  interval: 5s
  console_print: true
```

### 2. 运行测试

```bash
./mqtt-load-tester run -c config.yaml
```

### 3. 查看结果

测试完成后，CSV 报告将保存在配置文件指定的路径。

## HTTP API

当 `http_server.enabled` 设置为 `true` 时，可以通过 HTTP API 动态调整负载：

### 获取状态

```bash
GET /api/v1/status
```

响应示例：
```json
{
  "client_count": 10,
  "publish_rate": 10,
  "total_published": 600,
  "total_received": 598,
  "total_lost": 2,
  "out_of_order": 0,
  "avg_latency_ms": 2.5,
  "throughput_msg_sec": 10.0
}
```

### 获取详细统计

```bash
GET /api/v1/stats
```

### 增加客户端

```bash
POST /api/v1/clients/add
Content-Type: application/json

{
  "count": 5
}
```

### 减少客户端

```bash
POST /api/v1/clients/remove
Content-Type: application/json

{
  "count": 3
}
```

### 设置发布速率

```bash
POST /api/v1/publish-rate
Content-Type: application/json

{
  "rate": 20
}
```

### 健康检查

```bash
GET /health
```

## 配置说明

### Broker 配置

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `broker.host` | MQTT Broker 地址 | localhost |
| `broker.port` | MQTT Broker 端口 | 1883 (TCP), 8883 (TLS) |
| `broker.protocol` | 协议 (tcp/ssl/tls) | tcp |
| `broker.username` | 用户名 | - |
| `broker.password` | 密码 | - |
| `broker.tls.enabled` | 是否启用 TLS | false |
| `broker.tls.cert_file` | 客户端证书路径 | - |
| `broker.tls.key_file` | 客户端私钥路径 | - |
| `broker.tls.ca_file` | CA 证书路径 | - |
| `broker.tls.insecure_skip_verify` | 跳过证书验证 | false |

### 客户端配置

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `clients.count` | 客户端数量 | 10 |
| `clients.connect_timeout` | 连接超时 | 10s |
| `clients.keep_alive` | 心跳间隔 | 60s |
| `clients.client_id_prefix` | 客户端 ID 前缀 | load-tester |

### Topic 配置

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `topics.base_topic` | 基础 Topic | test/topic |
| `topics.share_group` | 共享订阅组名 | load-test-group |
| `topics.use_share_sub` | 是否使用共享订阅 | true |
| `topics.qos` | QoS 等级 (0/1/2) | 1 |

### 测试配置

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `testing.duration` | 测试持续时间 | 60s |
| `testing.message_size` | 消息大小（字节） | 100 |
| `testing.publish_rate` | 发布速率（消息/秒） | 10 |
| `testing.warmup_period` | 预热时间 | 5s |

### HTTP 服务配置

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `http_server.enabled` | 是否启用 HTTP 服务 | true |
| `http_server.host` | HTTP 服务监听地址 | 0.0.0.0 |
| `http_server.port` | HTTP 服务端口 | 8080 |

### 输出配置

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `output.csv_file` | CSV 报告文件名 | mqtt_load_test_report.csv |
| `output.interval` | 统计输出间隔 | 5s |
| `output.console_print` | 是否输出到控制台 | true |

## CSV 报告格式

CSV 报告包含两部分：

1. **时间序列数据**: 每个统计间隔的性能数据
2. **汇总数据**: 整个测试周期的总体统计

### 时间序列列

| 列名 | 说明 |
|------|------|
| `Timestamp` | 时间戳 |
| `Window_Duration_Seconds` | 统计窗口时长（秒） |
| `Published` | 发布消息数 |
| `Received` | 接收消息数 |
| `Lost` | 丢失消息数 |
| `Out_Of_Order` | 乱序消息数 |
| `Publish_Rate_Msg_Sec` | 发布速率（消息/秒） |
| `Receive_Rate_Msg_Sec` | 接收速率（消息/秒） |
| `Avg_Latency_Ms` | 平均延迟（毫秒） |
| `Min_Latency_Ms` | 最小延迟（毫秒） |
| `Max_Latency_Ms` | 最大延迟（毫秒） |

### 汇总列

包含所有总体统计指标，包括 P50、P95、P99 延迟百分位数。

## 使用示例

### 基本测试

```bash
# 使用默认配置
./mqtt-load-tester run

# 使用自定义配置
./mqtt-load-tester run -c my-config.yaml
```

### TLS 测试

```yaml
broker:
  host: mqtt.example.com
  port: 8883
  protocol: ssl
  tls:
    enabled: true
    ca_file: "/path/to/ca.crt"
    cert_file: "/path/to/client.crt"
    key_file: "/path/to/client.key"
```

### 带认证的测试

```yaml
broker:
  host: mqtt.example.com
  port: 1883
  username: "myuser"
  password: "mypassword"
```

### 共享订阅测试

```yaml
topics:
  base_topic: "sensors/temperature"
  share_group: "backend-processors"
  use_share_sub: true
```

### 动态负载调整

测试运行中，通过 HTTP API 增加负载：

```bash
# 增加 10 个客户端
curl -X POST http://localhost:8080/api/v1/clients/add \
  -H "Content-Type: application/json" \
  -d '{"count": 10}'

# 将发布速率提高到 50 msg/s
curl -X POST http://localhost:8080/api/v1/publish-rate \
  -H "Content-Type: application/json" \
  -d '{"rate": 50}'
```

### 故障注入测试

在测试运行中注入 Broker 故障，验证共享订阅的重新分配行为：

```bash
# 注入故障（断开所有客户端并自动重连）
curl -X POST http://localhost:8080/api/v1/failure/inject

# 查看故障统计
curl http://localhost:8080/api/v1/failure

# 查看故障事件历史
curl http://localhost:8080/api/v1/failure/events
```

测试结束后，控制台会输出故障注入的总结信息：

```
=== Failure Injection Summary ===
Total Failures: 2
Total Downtime: 8.23s
Average Downtime: 4.12s
Total Reconnect Attempts: 20
Successful Reconnects: 18
Failed Reconnects: 2
Reconnect Success Rate: 90.00%
Duplicate Messages: 15
Unconfirmed Messages: 47

Last Failure Details:
  Failure Time: 2024-01-01T12:00:00Z
  Recovery Time: 2024-01-01T12:00:04Z
  Duration: 4.12s
  Reconnect Time: 3.85s
  Messages Lost: 5
  Duplicate Messages: 8
  Unconfirmed Messages: 23
```

## 大规模测试最佳实践

当客户端数量超过 100 时，建议调整以下配置以避免 OOM：

```yaml
clients:
  count: 1000
  max_concurrent_connects: 30    # 降低并发连接数
  connect_delay: 200ms           # 增加连接间隔
  memory_monitor_interval: 10s   # 更频繁的内存监控
```

### 性能优化建议

1. **并发连接控制**: `max_concurrent_connects` 建议设置为 20-50，根据系统资源调整
2. **连接间隔**: `connect_delay` 建议 100-500ms，避免瞬间创建大量连接
3. **文件描述符**: 确保系统有足够的文件描述符：`ulimit -n 65535`
4. **TCP 端口**: 大量客户端连接需要足够的临时端口：
   ```bash
   sysctl -w net.ipv4.ip_local_port_range="1024 65535"
   sysctl -w net.ipv4.tcp_tw_reuse=1
   ```

### 监控内存使用

测试过程中，工具会定期输出内存统计：
```
Memory Stats: Alloc=45.23MB, Sys=89.31MB, NumGC=12
```

也可以通过 HTTP API 实时查询：
```bash
curl http://localhost:8080/api/v1/memory
```

### 优雅退出

工具支持 SIGINT (Ctrl+C) 和 SIGTERM 信号，收到信号后会：
1. 停止发布新消息
2. 等待所有进行中的操作完成
3. 逐个断开所有客户端连接
4. 写入最终的 CSV 报告

## 许可证

MIT License
