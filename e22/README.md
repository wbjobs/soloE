# Go HTTP Service Profiler with eBPF

一个基于eBPF技术的Go语言HTTP服务性能剖析系统。

## 项目结构

```
.
├── app/                # Go HTTP服务
│   ├── main.go         # 服务主程序
│   └── go.mod
├── ebpf/               # eBPF C代码
│   ├── profiler.bpf.c  # eBPF探针程序
│   └── go.mod
├── collector/           # eBPF加载器和数据采集API
│   ├── main.go         # 主程序（加载eBPF + API服务
│   └── go.mod
└── Makefile
```

## 功能特性

1. **Go HTTP服务** (`app/`):
   - `/heavy` - 模拟高CPU消耗的端点（冒泡排序）
   - `/light` - 轻量级请求端点

2. **eBPF探针** (`ebpf/`):
   - Uprobe挂载到 `net/http.(*ServeMux).ServeHTTP` 函数
   - 统计函数调用次数、总耗时、最小/最大/平均延迟

3. **数据采集API** (`collector/`):
   - `GET /api/v1/profile` - 获取性能统计数据（JSON格式）
   - 支持 `?no_reset=true` 参数保留累计数据

4. **Web前端界面** (`collector/static/`):
   - 访问 `http://localhost:9090/` - 可视化Web界面
   - 集成 d3-flame-graph 火焰图展示
   - 实时统计面板（调用次数、延迟统计）
   - 自动刷新功能
   - 模拟数据演示模式

## 环境要求

- Linux 内核 >= 5.4+ (支持eBPF)
- Go 1.21+
- Clang/LLVM (用于编译eBPF程序)
- libbpf-dev
- bpftool (可选，用于调试)

## 编译步骤

### 1. 安装依赖

```bash
# Ubuntu/Debian
sudo apt-get install clang llvm libbpf-dev linux-tools-common linux-tools-generic

# CentOS/RHEL
sudo yum install clang llvm libbpf-devel
```

### 2. 编译项目

```bash
# 编译所有组件
make all

# 或者分步编译
make build-app      # 只编译HTTP服务
make build-collector  # 只编译collector（包含eBPF代码生成）
```

## 使用方法

### 步骤1: 启动Go HTTP服务

```bash
cd app
./app
```

服务将在 `http://localhost:8080` 启动。

可用端点：
- `GET http://localhost:8080/heavy` - 高CPU负载请求
- `GET http://localhost:8080/light` - 轻量级请求

### 步骤2: 启动eBPF Collector（需要root权限）

```bash
cd collector
sudo ./collector -binary ../app/app
```

Collector将：
- 加载eBPF程序
- 挂载uprobe到目标二进制文件
- 在 `http://localhost:9090/api/v1/profile` 提供API

### 步骤3: 生成测试流量

```bash
# 发送一些高CPU请求
curl http://localhost:8080/heavy

# 发送轻量级请求
curl http://localhost:8080/light
```

### 步骤5: 获取性能数据

```bash
# 获取并自动重置统计数据（默认行为）
curl http://localhost:9090/api/v1/profile

# 获取数据但保留统计（不重置）
curl http://localhost:9090/api/v1/profile?no_reset=true
```

响应示例：
```json
{
  "success": true,
  "data": {
    "function_name": "net/http.(*ServeMux).ServeHTTP",
    "count": 15,
    "total_ns": 1234567890,
    "min_ns": 123456,
    "max_ns": 987654321,
    "avg_ns": 82304526
  }
}
```

**重要说明**：
- 默认情况下，每次读取数据后会自动重置eBPF Map，防止内存无限增长
- 使用 `?no_reset=true` 参数可以保留累计数据（不推荐长时间运行时使用
- 系统会每5分钟自动清理 `start_times` map中超过10分钟的残留条目

## eBPF实现细节

### Maps

1. **stats_map**: 存储函数统计数据
   - Key: 函数ID (uint32)
   - Value: 统计结构体 (count, total_ns, min_ns, max_ns)

2. **start_times**: 存储函数入口时间戳
   - Key: pid_tgid (uint64)
   - Value: 入口时间戳 (纳秒)

### Probes

- **uprobe**: 函数入口时记录开始时间
- **uretprobe**: 函数退出时计算耗时并更新统计

## 注意事项

1. **权限**: Collector需要root权限才能加载eBPF程序
2. **Go符号**: 确保目标二进制需要包含符号信息（不要使用-strip）
3. **内核版本**: 需要支持BTF（BPF Type Format）的内核
4. **位置独立可执行文件**: Go编译的二进制文件默认是PIE（Position Independent Executable）

## 故障排除

### 问题: uprobe挂载失败

```bash
# 检查二进制中的符号是否存在
nm ../app/app | grep "ServeHTTP"
```

### 问题: eBPF程序加载失败

```bash
# 检查内核配置
zcat /proc/config.gz | grep BPF

# 或者
cat /boot/config-$(uname -r) | grep BPF
```

## 许可证

Dual BSD/GPL (eBPF代码)
