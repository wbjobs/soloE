# P2P CDN 资源共享平台

一个基于 WebTorrent 协议的去中心化文件共享系统，使用 Go + Gin 作为后端，React + TypeScript 作为前端。

## 功能特性

- **文件分片上传**：文件自动切分为 1MB 分片
- **SHA-1 校验**：每个分片进行完整性校验
- **磁力链接**：生成标准的磁力链接用于资源分享
- **Tracker 服务**：内置 Tracker 服务器管理 P2P 节点
- **心跳检测**：实时监测在线节点状态
- **热度排序**：基于下载量、做种数和时间的热度算法
- **P2P 下载**：支持 WebRTC 点对点文件传输

## 项目结构

```
p2p-cdn/
├── backend/                 # 后端 Go 项目
│   ├── cmd/                # 入口文件
│   │   └── main.go        # 主程序
│   ├── internal/           # 内部包
│   │   ├── handler/        # HTTP 处理器
│   │   ├── model/          # 数据模型
│   │   └── service/        # 业务逻辑
│   ├── pkg/                # 公共包
│   │   └── middleware/     # 中间件
│   ├── storage/            # 文件存储目录
│   └── go.mod             # Go 依赖
└── frontend/               # 前端 React 项目
    ├── src/
    │   ├── components/     # 组件
    │   ├── pages/          # 页面
    │   ├── services/       # API 和 P2P 服务
    │   └── types/          # 类型定义
    ├── package.json
    └── vite.config.ts
```

## 快速开始

### 后端启动

```bash
cd backend
go mod download
go run cmd/main.go
```

后端服务将在 http://localhost:8080 启动

### 前端启动

```bash
cd frontend
npm install
npm run dev
```

前端服务将在 http://localhost:3000 启动

## API 接口

### 资源管理

- `POST /api/resource` - 上传文件
- `GET /api/resource` - 获取资源列表
- `GET /api/resource/:id` - 获取资源详情
- `GET /api/resource/:id/chunks` - 获取分片信息

### Tracker 服务

- `GET /api/tracker/announce` - 节点上报
- `GET /api/tracker/scrape` - 获取节点信息

### 心跳服务

- `POST /api/heartbeat` - 节点心跳上报

## 核心技术

### 后端

- **Go 1.21** - 编程语言
- **Gin** - Web 框架
- **SHA-1** - 哈希校验算法
- **内存缓存** - 节点和资源状态管理

### 前端

- **React 18** - UI 框架
- **TypeScript** - 类型系统
- **Vite** - 构建工具
- **Tailwind CSS** - 样式框架
- **WebRTC** - P2P 通信
- **CryptoJS** - 客户端哈希计算

## 分片下载流程

1. 用户上传文件，后端切分为 1MB 分片
2. 每个分片计算 SHA-1 哈希
3. 生成 InfoHash 和磁力链接
4. 上传者成为第一个种子节点
5. 下载者通过磁力链接解析 InfoHash
6. 连接 Tracker 获取在线节点列表
7. 通过 WebRTC 与其他节点建立连接
8. 并行下载多个分片
9. 下载完成后验证每个分片的哈希
10. 合并所有分片为完整文件
11. 下载者自动成为新的种子节点

## 热度排序算法

```
hotScore = (downloadCount * 0.6 + seeders * 0.3 + leechers * 0.1) / sqrt(hoursSinceCreated + 2)^1.5
```

## 许可证

MIT
