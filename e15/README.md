# CRDT Notes App

一个支持离线编辑、在线同步的笔记应用，使用 CRDT (Conflict-free Replicated Data Type) 技术解决多端编辑冲突。

## 技术栈

- **前端**: SolidJS + TypeScript + TailwindCSS
- **后端**: ElysiaJS + Bun
- **数据库**: SQLite
- **CRDT库**: Yjs
- **本地存储**: IndexedDB

## 核心功能

- ✅ 离线优先架构，所有操作首先在本地执行
- ✅ 实时文本编辑器，内容自动保存到 IndexedDB
- ✅ 网络状态检测，离线时显示提示
- ✅ 网络恢复时自动同步本地变更到服务器
- ✅ 基于 Yjs 的 CRDT 冲突合并，保证多端编辑一致性
- ✅ SQLite 持久化存储
- ✅ 笔记列表管理（创建、查看、搜索）
- ✅ 字符和字数统计

## 项目结构

```
e15/
├── frontend/               # 前端应用
│   ├── src/
│   │   ├── components/    # UI 组件
│   │   ├── hooks/        # SolidJS hooks
│   │   ├── services/     # API 服务
│   │   ├── utils/        # 工具函数
│   │   ├── types/        # 类型定义
│   │   └── App.tsx       # 主应用
│   └── package.json
├── backend/               # 后端服务
│   ├── src/
│   │   ├── db/           # 数据库层
│   │   ├── services/     # 业务逻辑
│   │   └── index.ts      # 服务器入口
│   └── package.json
└── package.json           # 根项目配置
```

## 快速开始

### 前置要求

- [Bun](https://bun.sh/) >= 1.3.x
- Node.js >= 20.x

### 安装依赖

```bash
# 安装根目录依赖
bun install

# 安装所有子项目依赖
bun run install:all
```

### 开发模式

#### 启动后端服务

```bash
bun run dev:backend
```

后端服务将在 http://localhost:3000 启动

#### 启动前端应用

```bash
bun run dev:frontend
```

前端应用将在 http://localhost:5173 启动

#### 同时启动前后端

```bash
bun run dev
```

## API 接口

### 获取笔记列表

```http
GET /api/notes
```

响应：
```json
{
  "notes": [
    {
      "id": "note_1234567890_abc123",
      "title": "My Note",
      "updatedAt": 1234567890000
    }
  ]
}
```

### 获取单个笔记

```http
GET /api/notes/:id
```

响应包含完整的笔记内容和 CRDT 状态。

### 创建笔记

```http
POST /api/notes
Content-Type: application/json

{
  "title": "New Note",
  "initialContent": "Hello World!"
}
```

### 同步变更

```http
POST /api/notes/:id/sync
Content-Type: application/json

{
  "updates": [1, 2, 3, ...],
  "clientVersion": 0
}
```

## CRDT 工作原理

本应用使用 Yjs 实现 CRDT 冲突解决：

1. **客户端**: 每个编辑操作生成 Yjs 更新，保存到 IndexedDB
2. **同步**: 在线时将累积的更新发送到服务器
3. **服务器**: 接收客户端更新，应用到服务器端 Y.Doc，计算新状态
4. **合并**: Yjs 自动处理并发编辑，保证最终一致性
5. **持久化**: 服务器状态保存到 SQLite 数据库

## 离线同步流程

```
用户编辑 → 本地保存到 IndexedDB → 网络恢复 → 发送变更到服务器 
→ CRDT 合并 → 更新数据库 → 返回最新状态 → 同步本地存储
```

## 数据库 Schema

### notes 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 笔记 ID (主键) |
| title | TEXT | 笔记标题 |
| content | TEXT | 笔记内容 |
| yjs_state | BLOB | Yjs 文档状态 |
| version | INTEGER | 版本号 |
| created_at | INTEGER | 创建时间 |
| updated_at | INTEGER | 更新时间 |

### updates 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 自增 ID |
| note_id | TEXT | 笔记 ID |
| update_data | BLOB | Yjs 更新数据 |
| created_at | INTEGER | 创建时间 |

## 特性说明

### 离线支持

- 所有编辑操作首先保存到本地 IndexedDB
- 网络状态实时监测，离线时显示红色指示器
- 网络恢复后自动触发同步，显示橙色 "Syncing..." 状态

### CRDT 优势

- **无需锁定**: 允许多端同时编辑
- **自动合并**: 算法自动处理冲突，无需人工干预
- **最终一致性**: 所有副本最终会达到相同状态
- **增量同步**: 只传输变更，减少带宽消耗

## 开发说明

### 前端开发

- 使用 SolidJS 的响应式系统管理状态
- Y.Doc 实例管理笔记内容，支持细粒度更新
- `useNetworkStatus` hook 检测网络状态变化

### 后端开发

- ElysiaJS 提供高性能 HTTP 服务
- Bun 的内置 SQLite 模块进行数据持久化
- 内存中缓存活跃的 Y.Doc 实例，减少反序列化开销

## 许可证

MIT
