# P2P 文件传输应用

基于 WebRTC 技术的浏览器端 P2P 文件直传应用。

## 功能特性

- 🔗 **P2P 直连：基于 WebRTC RTCDataChannel 实现
- 📁 **文件传输：支持拖拽上传，实时进度显示
- 🔒 **安全私密：文件直接传输，不经过服务器中转
- 🎯 **简单易用：创建房间 → 分享ID → 加入房间 → 传输文件

## 技术栈

### 后端
- Node.js + Express
- Socket.IO（信令服务器）

### 前端
- React 18 + TypeScript
- Vite
- Tailwind CSS
- Socket.IO Client
- WebRTC

## 快速开始

### 1. 启动后端服务

```bash
cd server
npm install
npm start
```

服务运行在 http://localhost:3001

### 2. 启动前端

```bash
cd client
npm install
npm run dev
```

前端运行在 http://localhost:3000

## 使用说明

1. **用户A 在浏览器打开 http://localhost:3000
2. 点击"创建新房间"，生成一个6位房间号
3. 将房间号分享给用户B
4. **用户B** 输入房间号并点击"加入"
5. 等待 P2P 连接建立（看到成功提示后即可开始传输文件
6. 拖拽文件到上传区域或点击选择文件
7. 文件开始传输，查看进度
8. 接收方自动下载文件

## 项目结构

```
.
├── server/                 # 后端信令服务器
│   ├── index.js         # 服务器入口
│   └── package.json
├── client/                # 前端应用
│   ├── src/
│   │   ├── components/   # React 组件
│   │   ├── hooks/      # 自定义 hooks
│   │   ├── types.ts     # TypeScript 类型定义
│   │   ├── App.tsx       # 主应用组件
│   │   └── main.tsx      # 入口文件
│   ├── index.html
│   └── package.json
│   └── vite.config.ts
└── .trae/documents/       # 项目文档
```

## 注意事项

- 🔧 本项目为局域网/本机测试使用，生产环境需要配置 TURN 服务器支持跨网络传输

## License

MIT
