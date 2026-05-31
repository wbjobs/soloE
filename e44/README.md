# P2P CDN 系统

基于 Node.js 和 WebRTC 的点对点内容分发网络系统。

## 功能特性

### 🚀 核心调度服务 (Tracker)
- **节点管理**: 注册、心跳检测、离线清理
- **资源索引**: 资源注册、分片信息管理
- **信令转发**: WebRTC 的 offer/answer/candidate 转发
- **WebSocket 实时通信**: 端口 3001

### 🧠 智能节点选择算法
- **地理位置评分**: 基于 IP 地理定位计算距离
- **NAT 类型评分**: 公网 > 锥形 NAT > 对称 NAT
- **带宽评分**: 上行带宽越高评分越高
- **加权综合**: 距离(40%) + NAT(30%) + 带宽(30%)

### 📦 分片调度策略
- **最少优先 (Rarest First)**: 优先下载最稀有的分片
- **随机选择**: 剩余分片随机下载，避免瓶颈
- **残局模式**: 最后阶段的特殊处理机制
- **分块大小**: 默认 1MB

### 🔐 SHA256 完整性校验
- 每个分片独立 SHA256 校验
- 支持 Merkle 树根校验
- 服务端和客户端双重验证

### 💻 前端 SDK (原生 JavaScript)
- WebRTC P2P 连接建立
- WebSocket 信令通信
- 分片下载与组装
- 下载进度回调
- 自动重连机制

## 项目结构

```
p2p-cdn/
├── package.json              # 依赖配置
├── server/
│   ├── index.js             # 主服务入口 (HTTP + WebSocket)
│   ├── config.js            # 配置文件
│   ├── WebSocketServer.js   # WebSocket 信令服务器
│   ├── models/
│   │   ├── Peer.js          # 节点数据模型
│   │   ├── Resource.js      # 资源数据模型
│   │   └── ChunkAvailability.js  # 分片可用性模型
│   └── services/
│       ├── PeerManager.js       # 节点管理器
│       ├── ResourceManager.js   # 资源管理器
│       ├── ChunkAvailabilityManager.js  # 分片可用性管理
│       ├── PeerSelector.js      # 智能节点选择器
│       ├── ChunkScheduler.js    # 分片调度器
│       └── HashVerifier.js      # 哈希校验器
└── public/
    ├── index.html          # 演示页面
    └── p2p-cdn-sdk.js     # 前端 SDK
```

## 安装与运行

### 前置要求
- Node.js 14+
- MongoDB (本地或远程)

### 安装依赖
```bash
npm install
```

### 启动服务
```bash
npm start
```

服务将在以下端口运行:
- **HTTP API**: http://localhost:3000
- **WebSocket**: ws://localhost:3001

### 访问演示页面
打开浏览器访问: http://localhost:3000

## API 接口

### 资源管理
- `POST /api/resources` - 注册新资源
- `GET /api/resources` - 获取所有资源列表
- `GET /api/resources/:resourceId` - 获取指定资源信息
- `POST /api/resources/:resourceId/chunks` - 更新分片哈希
- `POST /api/resources/:resourceId/hashes` - 批量更新分片哈希

### 节点管理
- `GET /api/peers` - 获取所有活跃节点
- `GET /api/peers/:peerId` - 获取指定节点信息

### 系统统计
- `GET /api/stats` - 获取系统统计信息

## 前端 SDK 使用方法

### 基本用法
```javascript
// 1. 引入 SDK
<script src="/p2p-cdn-sdk.js"></script>

// 2. 初始化
const sdk = new P2PCDNSDK({
    wsUrl: 'ws://localhost:3001',  // WebSocket 服务器地址
    chunkSize: 1024 * 1024,        // 分片大小 (默认 1MB)
    maxPeers: 10                     // 最大连接节点数
});

// 3. 事件监听
sdk.on('peerConnected', (peerId) => {
    console.log('节点已连接:', peerId);
});

sdk.on('chunkDownloaded', (data) => {
    console.log(`分片 ${data.chunkIndex} 下载完成`);
});

sdk.on('progress', (data) => {
    console.log(`进度: ${data.progress}%`);
});

sdk.on('downloadComplete', (blob) => {
    console.log('下载完成，文件大小:', blob.size);
    // 下载文件
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'filename';
    a.click();
});

// 4. 连接服务器
await sdk.connect();

// 5. 开始下载资源
await sdk.downloadResource('resource_id_here');
```

### 可用事件
| 事件名 | 说明 | 回调参数 |
|--------|------|----------|
| `peerConnected` | 节点连接成功 | peerId |
| `peerDisconnected` | 节点断开连接 | peerId |
| `chunkDownloaded` | 分片下载完成 | {chunkIndex, hash, size} |
| `progress` | 下载进度更新 | {downloaded, total, progress} |
| `downloadComplete` | 全部下载完成 | blob |
| `resourceInfo` | 资源信息接收 | resource |
| `sourceProgress` | 源站下载进度 | {downloaded, total} |

### API 方法
- `connect()` - 连接调度服务器
- `disconnect()` - 断开连接
- `downloadResource(resourceId)` - 通过 P2P 下载资源
- `downloadFromSource(url)` - 从源站下载（作为 seed）
- `getStats()` - 获取当前状态统计

## 工作原理

### 1. 节点发现与连接
1. 客户端通过 WebSocket 连接到调度服务器
2. 服务器返回当前在线节点列表
3. 客户端通过 WebRTC 与其他节点建立点对点连接

### 2. 资源注册与分片
1. 文件被分割成固定大小的分片（默认 1MB）
2. 每个分片计算 SHA256 哈希
3. 资源信息和分片信息存储到 MongoDB

### 3. 智能节点选择
1. 请求节点获取可用节点列表
2. 根据距离、NAT 类型、带宽计算每个节点的综合评分
3. 选择评分最高的节点建立连接

### 4. 分片调度
1. 统计每个分片在网络中的可用性
2. 优先请求最稀有的分片（最少优先）
3. 剩余分片随机请求
4. 下载到的分片立即广播给其他节点

### 5. 文件组装
1. 所有分片下载完成后
2. 按序号组装成完整文件
3. 转换为 Blob 供用户下载

## 配置说明

在 `server/config.js` 中可配置:

```javascript
module.exports = {
  mongodb: {
    uri: 'mongodb://localhost:27017/p2p_cdn'
  },
  server: {
    port: 3000,
    wsPort: 3001
  },
  p2p: {
    chunkSize: 1024 * 1024,  // 1MB
    maxPeers: 50
  },
  selection: {
    locationWeight: 0.4,   // 地理位置权重
    natWeight: 0.3,         // NAT 类型权重
    bandwidthWeight: 0.3    // 带宽权重
  }
};
```

## 技术栈

- **后端**: Node.js, Express, MongoDB, Mongoose
- **WebSocket**: ws 库
- **P2P**: WebRTC (RTCPeerConnection, RTCDataChannel)
- **哈希**: SHA256 (Crypto API / Node.js crypto)
- **地理定位**: geoip-lite

## 注意事项

1. **MongoDB 必须运行**: 确保 MongoDB 服务已启动
2. **HTTPS 要求**: 生产环境需要 HTTPS（WebRTC 限制）
3. **STUN/TURN 服务器**: 公网部署需要配置 TURN 服务器
4. **防火墙设置**: 确保端口 3000、3001 对外开放
5. **浏览器兼容性**: 支持现代浏览器（Chrome, Firefox, Safari, Edge）

## 扩展建议

- 实现 WebTorrent 协议兼容
- 添加流量统计和限速
- 实现 CDN 回源策略
- 添加 DHT 节点发现
- 实现拥塞控制算法
- 添加加密传输选项
- 实现浏览器 Service Worker 缓存

## 许可证

MIT
