# QUIC Load Tester

一个用Go语言开发的QUIC协议压测工具，支持单机模拟1000个并发连接向指定HTTP/3服务器发送请求。

## 功能特性

- 支持1000+并发连接
- 连接建立耗时分布统计（P50/P95/P99）
- 请求往返时间（RTT）统计
- 丢包和重传统计
- 可配置的请求频率控制
- 自定义请求体大小
- CSV格式测试报告生成

## 安装依赖

```bash
go mod tidy
```

## 编译

```bash
go build -o quic-load-tester
```

## 使用方法

1. 编辑配置文件 `config.yaml`

2. 运行压测工具：

```bash
# 使用默认配置文件
./quic-load-tester

# 指定配置文件
./quic-load-tester -config your-config.yaml
```

## 配置说明

```yaml
server:
  host: localhost      # 服务器地址
  port: 443            # 服务器端口
  path: /              # 请求路径
  method: GET          # HTTP方法
  insecure: true       # 是否跳过TLS验证

concurrency: 100              # 并发连接数
requests_per_second: 1000     # 每秒请求数
request_body_size_bytes: 0    # 请求体大小（字节）
request_count: 0              # 总请求数（0表示不限制）
duration_seconds: 60          # 测试时长（秒，0表示不限制）
output_csv_file: report.csv   # 输出报告文件名
```

## 输出报告

工具会生成CSV格式的测试报告，包含以下指标：

- 连接建立时间（平均值、P50、P95、P99）
- 请求往返时间（平均值、P50、P95、P99）
- 成功/失败请求数
- 成功率
- 丢包数
- 重传数

## 项目结构

```
.
├── config/          # 配置解析模块
├── stats/           # 统计模块
├── reporter/        # 报告生成模块
├── tester/          # 核心压测逻辑
├── main.go          # 主程序入口
├── config.yaml      # 配置文件示例
└── go.mod           # Go模块依赖
```
