# NFSv4 Proxy Server

一个纯用户态的 NFS 代理服务器，使用 Go 语言开发，支持拦截、记录、重放和模糊测试 NFS 请求。

## 功能特性

- **代理模式**: 拦截并转发 NFS 请求到真实的 NFS 服务器
- **请求日志**: 记录所有 RPC 请求（XDR 编码）到本地日志文件（支持 JSON、文本、二进制三种格式）
- **重放模式**: 从日志文件读取请求，向真实服务器或 Mock 服务器重放
- **模糊测试**: 自动修改请求中的文件句柄、offset、count 等字段，测试 NFS 服务器的健壮性
- **并发支持**: 支持并发重放请求，模拟真实负载
- **覆盖率报告**: 生成详细的操作覆盖率和性能报告
- **Mock 服务器**: 内置 Mock NFS 服务器，用于独立测试

## 项目结构

```
e:\soloE\e88\
├── cmd/
│   └── nfs-proxy/        # 主程序入口
├── internal/
│   ├── xdr/              # XDR 编码解码
│   ├── rpc/              # RPC 协议处理
│   ├── nfs/              # NFS 协议定义
│   ├── proxy/            # NFS 代理核心
│   ├── logger/           # 请求日志记录
│   ├── replay/           # 重放模式
│   ├── fuzz/             # 模糊测试
│   ├── coverage/         # 覆盖率报告
│   └── mock/             # Mock NFS 服务器
├── go.mod
├── go.sum
└── Makefile
```

## 编译

```bash
# 编译当前平台
make build

# 编译 Linux 版本
make build-linux

# 编译 Windows 版本
make build-windows

# 编译 macOS 版本
make build-mac
```

## 使用方法

### 1. 代理模式

启动代理服务器，将请求转发到真实的 NFS 服务器：

```bash
nfs-proxy proxy --listen :2049 --backend nfs-server:2049
```

选项：
- `--listen, -l`: 监听地址（默认: :2049）
- `--backend, -b`: 后端 NFS 服务器地址
- `--log-dir`: 日志目录（默认: ./logs）
- `--log-file`: 日志文件名前缀
- `--log-json`: 启用 JSON 日志（默认: true）
- `--log-raw`: 启用文本日志（默认: true）
- `--log-bin`: 启用二进制日志（默认: true）

### 2. 重放模式

从日志文件重放请求：

```bash
nfs-proxy replay logs/nfs_proxy_20240101_120000.bin --target nfs-server:2049 --concurrency 10
```

选项：
- `--target, -t`: 目标 NFS 服务器地址
- `--concurrency, -c`: 并发请求数（默认: 10）
- `--report`: 保存报告到文件
- `--use-mock`: 使用内置 Mock 服务器作为目标

### 3. 模糊测试

对 NFS 服务器进行模糊测试：

```bash
nfs-proxy fuzz logs/nfs_proxy_20240101_120000.bin --target nfs-server:2049 --iterations 10000
```

选项：
- `--target, -t`: 目标 NFS 服务器地址
- `--concurrency, -c`: 并发请求数（默认: 10）
- `--iterations, -i`: 模糊测试迭代次数（默认: 1000）
- `--modify-fh`: 修改文件句柄（默认: true）
- `--modify-offset`: 修改 offset 字段（默认: true）
- `--modify-count`: 修改 count 字段（默认: true）
- `--modify-all`: 修改所有字段
- `--corrupt`: 随机破坏 payload 字节
- `--report`: 保存报告到文件
- `--use-mock`: 使用内置 Mock 服务器作为目标

### 4. Mock 服务器

启动内置的 Mock NFS 服务器用于测试：

```bash
nfs-proxy mock --listen :2049
```

选项：
- `--listen, -l`: 监听地址（默认: :2049）
- `--delay`: 人工响应延迟（用于模拟网络延迟）

## 日志格式

代理服务器会生成三种格式的日志文件：

1. **JSON 格式** (.json): 结构化的日志数据，便于程序解析
2. **文本格式** (.raw): 人类可读的日志摘要
3. **二进制格式** (.bin): 完整的 XDR 编码数据，用于重放

## 使用示例

### 完整测试流程

```bash
# 1. 启动 Mock 服务器
nfs-proxy mock --listen :2049 &

# 2. 启动代理服务器
nfs-proxy proxy --listen :2050 --backend localhost:2049 &

# 3. 使用 NFS 客户端通过代理访问（产生流量）
mount -o port=2050,mountport=2050,nfsvers=3,tcp localhost:/mount /mnt/nfs

# 4. 停止代理，查看生成的日志文件
ls -la logs/

# 5. 重放请求到 Mock 服务器
nfs-proxy replay logs/nfs_proxy_*.bin --use-mock --concurrency 20 --report replay_report.txt

# 6. 运行模糊测试
nfs-proxy fuzz logs/nfs_proxy_*.bin --use-mock --iterations 5000 --concurrency 50 --report fuzz_report.txt
```

## 支持的 NFS 操作

- NFSv3: NULL, GETATTR, SETATTR, LOOKUP, ACCESS, READLINK, READ, WRITE, CREATE, MKDIR, SYMLINK, MKNOD, REMOVE, RMDIR, RENAME, LINK, READDIR, READDIRPLUS, FSSTAT, FSINFO, PATHCONF, COMMIT
- NFSv4: NULL, COMPOUND
- MOUNT: NULL, MNT, UMNT, UMNTALL, EXPORT

## 模糊测试策略

模糊测试模块会对请求进行以下修改：

1. **文件句柄修改**: 替换请求中的文件句柄为随机字节
2. **Offset 修改**: 修改 READ/WRITE 请求的 offset 字段
3. **Count 修改**: 修改 READ/WRITE 请求的 count 字段
4. **Payload 破坏**: 随机修改 payload 中的字节

## 报告格式

报告包含以下信息：
- 总请求数和成功率
- 每个操作的调用次数、成功率、延迟统计
- 错误统计和崩溃详情
- 操作覆盖率百分比

## 许可证

Apache License 2.0
