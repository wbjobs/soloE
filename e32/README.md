# 白板协作系统

基于 WebRTC + NestJS + Socket.io + Vue3 + Fabric.js 的实时多人协作白板系统。

## 功能特性

- ✅ 6位数字房间码创建/加入房间
- ✅ 支持至少3个客户端同时连接
- ✅ 画笔、矩形、文字三种绘制工具
- ✅ 多种颜色选择和画笔大小调节
- ✅ 实时同步所有用户的绘制操作
- ✅ 服务端记录操作日志
- ✅ 支持回放最近5分钟的操作
- ✅ WebRTC 信令服务器支持

## 项目结构

```
e32/
├── backend/          # NestJS 后端
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   └── whiteboard/
│   │       ├── whiteboard.module.ts
│   │       ├── whiteboard.service.ts
│   │       └── whiteboard.gateway.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── nest-cli.json
└── frontend/         # Vue3 前端
    ├── src/
    │   ├── main.js
    │   ├── App.vue
    │   ├── style.css
    │   └── components/
    │       ├── RoomManager.vue
    │       └── Whiteboard.vue
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## 快速开始

### 1. 启动后端服务

```bash
cd backend
npm install
npm run start
```

后端服务将运行在 `http://localhost:3000`

### 2. 启动前端服务

新开一个终端窗口：

```bash
cd frontend
npm install
npm run dev
```

前端服务将运行在 `http://localhost:5173`

### 3. 使用说明

1. 打开浏览器访问 `http://localhost:5173`
2. 点击"创建房间"，系统会生成一个6位房间码
3. 在另一个浏览器窗口（或标签页）打开同样的地址
4. 输入房间码并点击"加入房间"
5. 现在可以开始多人协作了！

## 技术栈

### 后端
- **NestJS**: Node.js 框架
- **Socket.io**: 实时通信
- **TypeScript**: 类型安全

### 前端
- **Vue 3**: 渐进式 JavaScript 框架
- **Fabric.js**: Canvas 绘图库
- **Socket.io-client**: 客户端实时通信
- **Vite**: 构建工具

## API 说明

### Socket.io 事件

| 事件名 | 方向 | 参数 | 说明 |
|--------|------|------|------|
| `create-room` | Client→Server | - | 创建房间 |
| `join-room` | Client→Server | `{ roomId }` | 加入房间 |
| `draw-action` | Client→Server | `{ roomId, type, data }` | 发送绘制操作 |
| `draw-action` | Server→Client | `{ type, data, userId, timestamp }` | 广播绘制操作 |
| `get-actions` | Client→Server | `{ roomId }` | 获取历史操作 |
| `get-recent-actions` | Client→Server | `{ roomId }` | 获取最近5分钟操作 |
| `clear-canvas` | Client→Server | `{ roomId }` | 清空画布 |
| `signal` | Client→Server | `{ roomId, targetUserId, signalData }` | WebRTC 信令 |
| `user-joined` | Server→Client | `userId` | 用户加入通知 |
| `user-left` | Server→Client | `userId` | 用户离开通知 |

## 操作类型

- `draw`: 画笔绘制（自由路径）
- `rect`: 矩形绘制
- `text`: 文字添加
- `clear`: 清空画布

## 注意事项

1. 操作记录仅保留最近5分钟的数据
2. 房间数据存储在内存中，服务重启后会丢失
3. WebRTC 信令功能已预留，可进一步扩展实现 P2P 数据传输
