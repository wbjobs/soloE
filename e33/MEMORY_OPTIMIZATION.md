# 内存泄漏修复和性能优化说明

## TLS会话复用功能

### 实现原理

通过实现`tls.ClientSessionCache`接口，缓存TLS会话ticket，使后续连接可以复用之前的会话：

```go
type SessionCache struct {
    cache    map[string]*tls.ClientSessionState
    // ...
}
```

### 性能优势

1. **减少握手延迟**: 复用TLS会话可以跳过完整的握手流程，减少RTT
2. **降低CPU开销**: 减少加密操作
3. **节省带宽**: 减少握手数据包

### 统计指标

新增统计指标：
- **TLS Session Total**: 总TLS会话数
- **TLS Session Reused**: 复用的会话数
- **TLS Session New**: 新建的会话数
- **TLS Session Reuse Rate**: 会话复用率 (%)

---

## 修复的问题

### 1. 每个请求创建新连接导致的内存泄漏
**问题**: 原代码中每个worker都创建新的`http3.RoundTripper`，每个RoundTripper内部维护多个QUIC连接、TLS上下文和缓冲区，大量连接同时打开会导致：
- 内存占用持续增长
- 文件句柄耗尽
- GC压力过大

**解决方案**: 实现连接池`ConnectionPool`，复用HTTP3连接
- 池大小 = 并发连接数
- 连接有最大生命周期和最大使用次数
- 自动回收过期连接

### 2. 同步日志导致的性能瓶颈
**问题**: 高并发下使用`fmt.Println`同步打印日志，导致大量goroutine阻塞在IO操作上

**解决方案**: 实现环形缓冲区+异步日志
- 使用带缓冲的channel作为日志缓冲区（容量1000）
- 单独的worker goroutine负责异步写入日志
- 缓冲区满时丢弃而非阻塞（无损压测性能）

## 优化特性

### 连接池 (ConnectionPool)
```go
type ConnectionPool struct {
    pool        chan *PooledConnection  // 连接池队列
    capacity    int                      // 最大连接数
    maxLifetime time.Duration            // 连接最大生命周期 (10分钟)
    maxUses     int                      // 连接最大使用次数 (10000次)
    // ...
}
```

**优化点**:
- 按需创建连接，避免预分配过多资源
- 连接健康检查，自动回收过期连接
- 线程安全的获取/归还操作
- 测试结束时正确关闭所有连接

### 环形缓冲区日志 (RingBuffer)
```go
type RingBuffer struct {
    buffer   chan string  // 带缓冲的日志队列
    capacity int          // 缓冲区容量
    // ...
}
```

**优化点**:
- 非阻塞写入：`select { case buffer <- msg: default: }`
- 优雅关闭：停止前清空缓冲区
- 单goroutine写入，避免锁竞争

### 缓冲池 (BufferPool)
```go
type BufferPool struct {
    pool sync.Pool  // 复用bytes.Buffer
}
```

**优化点**:
- 使用`sync.Pool`复用内存缓冲
- 减少GC压力，避免频繁的内存分配/回收
- 预分配32KB缓冲区，适配大多数HTTP响应大小

### 请求体预生成
**优化点**:
- 程序启动时一次性生成请求体
- 所有请求共享同一份数据副本
- 避免为每个请求都生成随机数据

## 内存使用对比

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 连接数 | = 请求数 | = 并发数 |
| 内存增长 | 随请求数线性增长 | 稳定在并发数级别 |
| GC频率 | 高 | 低 |
| 文件句柄 | 可能耗尽 | 稳定 |

## 使用建议

1. **并发数设置**: 建议设置为目标服务器能承受的最大并发，连接池会自动复用
2. **请求速率**: 如需最大压力测试，可将`requests_per_second`设为0，将无限制发送
3. **日志级别**: 压测时减少日志输出，本实现已将进度输出从每100次改为每1000次
4. **连接回收**: 连接最大生命周期和最大使用次数已设为合理值，通常无需调整

## 资源清理流程

测试结束时的资源清理顺序：
1. 发送停止信号给所有worker
2. 等待所有请求完成
3. 清空并关闭日志缓冲区
4. 关闭连接池中所有连接
5. 生成测试报告
