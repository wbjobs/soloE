# WebRTC 多方音视频会议系统

基于 WebRTC + mediasoup 的 SFU 架构多方音视频会议系统。

## 功能特性

- ✅ 支持最多 4 人同时加入会议
- ✅ 三档码率控制：低画质(300kbps)、中画质(800kbps)、高画质(1.5Mbps)
- ✅ 实时网络状态监测（RTT 延迟、丢包率）
- ✅ SFU 媒体服务器智能转发
- ✅ 码率自适应算法（根据网络状况动态调整）
- ✅ 音视频开关控制
- ✅ React + TypeScript 前端

## 技术架构

### 服务端
- **Node.js** + **Express**
- **Socket.io** - 信令服务器
- **mediasoup** - SFU 媒体服务器

### 客户端
- **React 18** + **TypeScript**
- **Vite** - 构建工具
- **mediasoup-client** - WebRTC 客户端库
- **socket.io-client**

## 项目结构

```
.
├── server/                 # 服务端
│   ├── src/
│   │   ├── index.js       # 入口文件 (信令服务器)
│   │   ├── config/
│   │   │   └── mediasoupConfig.js
│   │   ├── mediasoup/
│   │   │   └── MediasoupManager.js
│   │   └── adaptation/
│   │       ├── BitrateAdaptation.js    # 码率自适应
│   │       └── NetworkProbe.js         # 网络探测
│   └── package.json
└── client/                # 前端
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── components/
    │   │   ├── JoinForm.tsx
    │   │   ├── ConferenceRoom.tsx
    │   │   ├── VideoPlayer.tsx
    │   │   └── BitrateControl.tsx
    │   ├── services/
    │   │   └── WebRtcClient.ts
    │   └── types/
    │       └── index.ts
    └── package.json
```

## 快速开始

### 1. 安装依赖

**服务端:**
```bash
cd server
npm install
```

**前端:**
```bash
cd client
npm install
```

### 2. 启动服务

**启动服务端 (端口 3001):**
```bash
cd server
npm start
```

**启动前端 (端口 3000):**
```bash
cd client
npm run dev
```

### 3. 使用说明

1. 打开浏览器访问 `http://localhost:3000`
2. 输入会议室 ID (如: `meeting-1`) 和昵称
3. 点击"加入会议"
4. 允许浏览器访问摄像头和麦克风
5. 其他人使用相同的会议室 ID 加入即可

## 核心模块说明

### 网络探测模块 (NetworkProbe)

- 实时采集 RTT 往返延迟
- 丢包率统计
- 网络质量评分

### 码率自适应算法 (BitrateAdaptation)

- 基于 RTT 和丢包率计算网络评分
- 连续 3 次网络良好 → 提升画质
- 连续 2 次网络较差 → 降低画质
- 带滞后效应的状态切换，避免抖动

### mediasoup 管理 (MediasoupManager)

- Worker 池管理
- Router 创建与管理
- WebRTC Transport 创建
- Producer/Consumer 管理
- 动态设置 Consumer 首选层级

## 码率配置

| 质量 | 码率范围 | 适用场景 |
|------|----------|----------|
| 低 | 300kbps | 弱网环境 |
| 中 | 800kbps | 普通网络 |
| 高 | 1.5Mbps | 良好网络 |

## 注意事项

1. 需要 HTTPS 环境才能在公网使用（本地开发 localhost 除外）
2. mediasoup 需要配置正确的 announcedIp 用于公网部署
3. 确保 UDP 端口 (默认 10000-10100) 防火墙开放
4. 建议使用 Chrome 或 Edge 浏览器获得最佳体验
