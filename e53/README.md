# Light TSDB - 轻量级时序数据库

一个用Rust实现的高性能时序数据库，支持HTTP API写入和查询，优化了高并发场景下的查询性能。

## 核心功能

- **数据模型**: metric名称 + tags键值对 + timestamp + value
- **存储引擎**: 改进的LSM树（Log-Structured Merge Tree）结构
  - **Leveled Compaction**: 分层压缩策略，减少写放大和查询延迟
  - **布隆过滤器**: SSTable级别的布隆过滤器，快速判断key是否存在
  - **后台Compaction**: 独立线程执行压缩，不阻塞写入
- **数据压缩**: Simple8B算法压缩时间戳
- **PromQL子集**: 支持范围查询、rate函数、avg聚合
- **降采样 (Downsampling)**: 自动聚合高分辨率数据
  - 可配置自动聚合规则（avg/max/min/sum/count）
  - 后台异步执行降采样任务
  - 查询时自动路由到最合适的粒度
- **TTL策略**: 按天自动删除过期数据
- **持久化**: 数据持久化到本地磁盘
- **可观测性**: 内置读取放大和写入放大监控指标

## 项目结构

```
src/
├── main.rs          # 主程序入口
├── lib.rs           # 库文件
├── data.rs          # 数据模型定义
├── compression.rs   # Simple8B压缩算法
├── lsm.rs           # LSM树存储引擎
├── promql.rs        # PromQL解析器和执行器
├── server.rs        # HTTP API服务器
├── ttl.rs           # TTL数据保留策略
├── downsampling.rs  # 降采样管理器
└── config.rs        # 配置管理
```

## 编译和运行

```bash
# 编译
cargo build --release

# 运行（默认端口8080，数据目录./data）
./target/release/light_tsdb

# 指定参数运行
./target/release/light_tsdb --host 0.0.0.0 --port 8080 --data-dir /data/tsdb --retention-days 30 --log-level info
```

## HTTP API

### 写入数据

```bash
POST /write
Content-Type: application/json

{
  "metric": "cpu_usage",
  "tags": {
    "host": "server1",
    "region": "us-east"
  },
  "timestamp": 1716585600000,
  "value": 75.5
}
```

### 查询数据

```bash
GET /query?query=cpu_usage{host="server1"}&start=1716585600000&end=1716596400000&step=60000
```

支持的PromQL查询示例：
- `cpu_usage{host="server1"}` - 指标选择
- `rate(cpu_usage[5m])` - 变化率计算
- `avg(cpu_usage{region="us-east"})` - 平均值聚合

### 健康检查

```bash
GET /health
```

### 获取性能指标

```bash
GET /metrics
```

返回示例：
```json
{
  "write_amplification": 2.5,
  "read_amplification": 1.2,
  "total_writes": 10000,
  "total_compacted_bytes": 1024000,
  "total_queries": 5000,
  "sstables_read_per_query": 1.2
}
```

### 降采样规则管理

#### 列出所有降采样规则
```bash
GET /downsampling/rules
```

#### 添加降采样规则
```bash
POST /downsampling/rules
Content-Type: application/json

{
  "metric_pattern": "cpu_usage",
  "tags_filter": null,
  "source_resolution_ms": 1000,
  "target_resolution_ms": 300000,
  "aggregation": "Avg",
  "retention_days": 30,
  "enabled": true
}
```

**参数说明：**
- `metric_pattern`: 匹配的指标名称前缀
- `tags_filter`: 可选的标签过滤器，只匹配特定标签的时间序列
- `source_resolution_ms`: 原始数据分辨率（毫秒）
- `target_resolution_ms`: 目标降采样分辨率（毫秒）
- `aggregation`: 聚合类型，支持 `Avg`, `Max`, `Min`, `Sum`, `Count`
- `retention_days`: 降采样数据保留天数
- `enabled`: 是否启用该规则

#### 删除降采样规则
```bash
DELETE /downsampling/rules/0
```

## 降采样使用示例

### 1. 添加5分钟平均值降采样规则

```bash
curl -X POST http://localhost:8080/downsampling/rules \
  -H "Content-Type: application/json" \
  -d '{
    "metric_pattern": "cpu_usage",
    "source_resolution_ms": 1000,
    "target_resolution_ms": 300000,
    "aggregation": "Avg",
    "retention_days": 30,
    "enabled": true
  }'
```

### 2. 添加1小时最大值降采样规则

```bash
curl -X POST http://localhost:8080/downsampling/rules \
  -H "Content-Type: application/json" \
  -d '{
    "metric_pattern": "cpu_usage",
    "source_resolution_ms": 1000,
    "target_resolution_ms": 3600000,
    "aggregation": "Max",
    "retention_days": 90,
    "enabled": true
  }'
```

### 3. 查询大范围时间数据（自动使用降采样）

```bash
# 查询过去7天的数据，系统会自动选择最合适的降采样分辨率
curl "http://localhost:8080/query?query=cpu_usage{host=\"server1\"}&start=$(date -d '7 days ago' +%s)000&end=$(date +%s)000&step=300000"
```

## 性能优化特性

### 1. Leveled Compaction 分层压缩策略
- 按层级管理SSTable，每层有最大容量限制
- 只选择重叠的SSTable进行合并，减少不必要的IO
- 减少写放大，提高查询性能

### 2. 布隆过滤器 Bloom Filter
- 每个SSTable内置布隆过滤器
- 快速判断key是否存在，避免不必要的磁盘IO
- 显著减少查询延迟

### 3. 后台异步Compaction
- 独立后台线程执行压缩操作
- 使用信号量控制并发，不阻塞正常写入
- 高并发场景下查询延迟稳定

### 4. 查询时数据版本合并优化
- 从MemTable、Immutable MemTable和各层SSTable收集数据
- 按时间戳排序并去重，保留最新版本
- 优化合并算法，减少内存占用

### 5. 智能降采样
- 根据查询时间范围自动选择最合适的数据分辨率
- 大幅减少长时间范围查询的数据量
- 后台异步执行降采样任务，不影响写入性能

## 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--host` | 0.0.0.0 | 监听地址 |
| `--port` | 8080 | 监听端口 |
| `--data-dir` | ./data | 数据存储目录 |
| `--retention-days` | 7 | 原始数据保留天数 |
| `--log-level` | info | 日志级别 |
