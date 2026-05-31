# Coturn TURN 服务器部署指南

## 概述

Coturn 是一个开源的 STUN/TURN 服务器，用于 WebRTC 的 NAT 穿透和中继。为了实现 P2P 连接成功率 >95%，必须正确配置和部署 TURN 服务器。

## 快速开始

### 1. 环境要求

- Linux 服务器（推荐 Ubuntu 20.04+ 或 CentOS 7+）
- 公网 IP 地址
- 开放的 UDP/TCP 端口（默认 3478, 5349）
- 域名（可选，用于 TLS 证书）

### 2. 使用 Docker 快速部署

```bash
# 从 Docker Hub 拉取 coturn 镜像
docker pull coturn/coturn

# 运行 coturn 容器
docker run -d \
  --name=coturn \
  --network=host \
  -v $(pwd)/coturn.conf:/etc/coturn/turnserver.conf \
  coturn/coturn
```

### 3. 使用部署脚本

```bash
# Ubuntu/Debian
chmod +x install_coturn_ubuntu.sh
sudo ./install_coturn_ubuntu.sh

# CentOS/RHEL
chmod +x install_coturn_centos.sh
sudo ./install_coturn_centos.sh
```

## 配置说明

### 基础配置 (coturn.conf)

```ini
# 监听端口
listening-port=3478
tls-listening-port=5349

# 监听 IP（替换为你的内网 IP）
listening-ip=0.0.0.0

# 外部 IP（替换为你的公网 IP）
external-ip=YOUR_PUBLIC_IP

# 用户名和密码（与 P2P CDN 系统配置一致）
user=p2pcdn:p2pcdn123

# 域名配置（如果有）
# realm=turn.yourdomain.com

# 最大同时连接数
max-bps=10485760
bps-capacity=0

# 连接超时设置
stale-nonce=600

# 认证方式
cert=/etc/letsencrypt/live/turn.yourdomain.com/cert.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem

# 日志配置
log-file=/var/log/turnserver.log
verbose

# 允许的对等 IP 范围（可以限制为你的服务 IP）
# allowed-peer-ip=10.0.0.0-10.255.255.255
# allowed-peer-ip=192.168.0.0-192.168.255.255
```

### 安全配置建议

1. **使用强密码**：不要使用示例密码
2. **启用 TLS**：生产环境必须使用 5349 端口的 TLS
3. **IP 白名单**：限制 allowed-peer-ip 范围
4. **带宽限制**：根据服务器带宽设置 max-bps
5. **定期轮换密钥**：定期更新用户名和密码

### Let's Encrypt TLS 证书配置

```bash
# 安装 certbot
apt-get install certbot -y

# 获取证书（需要域名指向此服务器）
certbot certonly --standalone -d turn.yourdomain.com

# 自动续期配置
crontab -e
# 添加：0 12 * * * /usr/bin/certbot renew --quiet --post-hook "systemctl restart coturn"
```

## 端口配置

确保以下端口在防火墙中开放：

| 端口 | 协议 | 用途 | 是否必须 |
|------|------|------|----------|
| 3478 | UDP | STUN/TURN UDP 中继 | 是 |
| 3478 | TCP | STUN/TURN TCP 中继 | 推荐 |
| 5349 | TCP | STUN/TURN TLS 中继 | 生产环境推荐 |
| 49152-65535 | UDP | TURN 中继端口范围 | 是 |

### Ubuntu UFW 防火墙配置

```bash
# 开放 STUN/TURN 端口
ufw allow 3478/udp
ufw allow 3478/tcp
ufw allow 5349/tcp
ufw allow 49152:65535/udp

# 查看状态
ufw status
```

### CentOS firewalld 配置

```bash
# 开放端口
firewall-cmd --permanent --add-port=3478/udp
firewall-cmd --permanent --add-port=3478/tcp
firewall-cmd --permanent --add-port=5349/tcp
firewall-cmd --permanent --add-port=49152-65535/udp

# 重载配置
firewall-cmd --reload
```

## 验证 TURN 服务器

### 1. 检查服务状态

```bash
# 检查 coturn 进程
ps aux | grep turnserver

# 检查端口监听
netstat -tulpn | grep turnserver

# 查看日志
tail -f /var/log/turnserver.log
```

### 2. 使用 WebRTC 测试工具

使用 Trickle ICE 测试工具验证 TURN 服务器：

1. 访问：https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
2. 添加你的 TURN 服务器配置：
   - URI: `turn:your-server-ip:3478`
   - Username: `p2pcdn`
   - Password: `p2pcdn123`
3. 点击 "Gather candidates"
4. 检查是否收集到 `relay` 类型的候选者

### 3. curl 测试

```bash
# 测试 STUN 功能
curl -v stun:your-server-ip:3478
```

## P2P CDN 系统集成

### 更新服务端配置

在 `server/config.js` 中更新 TURN 服务器信息：

```javascript
module.exports = {
  // ... 其他配置
  p2p: {
    // ...
    turnServers: [
      {
        urls: 'turn:your-turn-server-ip:3478',
        username: 'p2pcdn',
        credential: 'your-strong-password'
      },
      // 可以配置多个 TURN 服务器作为备份
      {
        urls: 'turn:your-backup-turn-ip:3478',
        username: 'p2pcdn',
        credential: 'your-strong-password'
      }
    ]
  }
};
```

### 高可用部署方案

#### 方案一：DNS 轮询 + 健康检查

```
用户
  ↓
DNS 轮询 (turn1, turn2, turn3)
  ↓
TURN 服务器集群
  ↓
P2P 节点
```

#### 方案二：负载均衡

```
用户
  ↓
负载均衡器 (UDP/TCP)
  ↓
TURN 服务器池
  ↓
P2P 节点
```

## 性能调优

### 系统参数调优

```bash
# 编辑 sysctl 配置
vi /etc/sysctl.conf

# 添加以下配置
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 16777216
net.core.wmem_default = 16777216
net.core.netdev_max_backlog = 30000
net.ipv4.ip_local_port_range = 49152 65535
fs.file-max = 100000

# 应用配置
sysctl -p
```

### Coturn 性能配置

```ini
# 增加文件描述符限制
syslog-max-lines=100000

# 增加工作线程数
relay-threads=10

# 限制单用户带宽
max-bps=10485760

# 限制总带宽
bps-capacity=1073741824

# 分配端口范围
min-port=49152
max-port=65535
```

## 监控与日志

### 日志轮转配置

```bash
# /etc/logrotate.d/coturn
/var/log/turnserver.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 turnserver turnserver
    postrotate
        systemctl reload coturn > /dev/null 2>&1 || true
    endscript
}
```

### Prometheus 监控

Coturn 支持统计信息输出，可以配合 Prometheus 进行监控：

```ini
# 启用统计
stats-output-file=/var/log/turnserver_stats.log
stats-period=60
```

## 常见问题排查

### 1. 无法收集到 relay 候选者

- 检查防火墙/安全组是否开放 UDP 端口
- 确认 external-ip 配置正确
- 检查用户名密码是否匹配
- 查看 turnserver.log 日志

### 2. 连接成功率低

- 确认 STUN 服务器可达
- 检查 NAT 类型（对称 NAT 需要 TURN）
- 考虑部署地理位置相近的 TURN 服务器
- 增加 ICE 收集超时时间

### 3. 带宽耗尽

- 监控服务器带宽使用
- 配置 max-bps 限制单用户带宽
- 考虑横向扩展 TURN 服务器

### 4. 日志显示权限错误

```bash
# 修复日志目录权限
chown -R turnserver:turnserver /var/log/turnserver/
```

## 成本估算

### 小规模部署（<1000 并发用户）

- **服务器**：2核4GB，带宽 100Mbps
- **月成本**：约 $50-$100
- **预期成功率**：~95%

### 中等规模部署（1000-10000 并发用户）

- **服务器**：4核8GB，带宽 1Gbps
- **月成本**：约 $200-$500
- **预期成功率**：~97%

### 大规模部署（>10000 并发用户）

- **服务器集群**：多区域部署
- **负载均衡**：UDP 负载均衡
- **月成本**：$1000+
- **预期成功率**：98%+

## 公共 TURN 服务器列表

以下是一些免费的公共 TURN 服务器（仅用于测试，生产环境请部署自己的服务器）：

```javascript
// 注意：公共服务器可能不稳定，仅供测试
[
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'stun:stun.cloudflare.com:3478' }
]
```

## 参考链接

- Coturn 官方文档：https://github.com/coturn/coturn
- WebRTC ICE 标准：https://tools.ietf.org/html/rfc8445
- Trickle ICE 测试工具：https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
- WebRTC 调试工具：chrome://webrtc-internals/
