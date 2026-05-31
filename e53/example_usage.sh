#!/bin/bash

# Light TSDB 示例使用脚本

echo "=== 启动时序数据库 ==="
./target/release/light_tsdb --port 8080 &
PID=$!

sleep 3

echo ""
echo "=== 写入测试数据 ==="
curl -X POST http://localhost:8080/write \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "cpu_usage",
    "tags": {"host": "server1", "region": "us-east"},
    "timestamp": '$(date +%s%3N)',
    "value": 75.5
  }'

echo ""
curl -X POST http://localhost:8080/write \
  -H "Content-Type: application/json" \
  -d '{
    "metric": "cpu_usage",
    "tags": {"host": "server2", "region": "us-east"},
    "timestamp": '$(date +%s%3N)',
    "value": 65.2
  }'

echo ""
echo ""
echo "=== 查询单个指标 ==="
curl "http://localhost:8080/query?query=cpu_usage{host=\"server1\"}"

echo ""
echo ""
echo "=== 计算rate函数 ==="
curl "http://localhost:8080/query?query=rate(cpu_usage[5m])"

echo ""
echo ""
echo "=== avg聚合 ==="
curl "http://localhost:8080/query?query=avg(cpu_usage{region=\"us-east\"})"

echo ""
echo ""
echo "=== 健康检查 ==="
curl http://localhost:8080/health

echo ""
echo ""
echo "=== 停止服务 ==="
kill $PID
