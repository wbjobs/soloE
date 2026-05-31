## 1. 架构设计

```mermaid
graph TB
    subgraph "前端层"
        FE["React + TypeScript"]
        WT["WebTorrent (浏览器端)"]
        WR["WebRTC 点对点传输"]
    end
    
    subgraph "后端层"
        GIN["Go + Gin Web框架"]
        TRK["Tracker 服务器"]
        IDX["资源索引服务"]
        HS["心跳检测服务"]
    end
    
    subgraph "数据层"
        FS["文件系统 (分片存储)"]
        MEM["内存缓存 (节点状态)"]
    end
    
    FE --> GIN
    FE --> WR
    WR --> TRK
    GIN --> IDX
    GIN --> HS
    GIN --> FS
    GIN --> MEM
    TRK --> MEM
    IDX --> FS
```

## 2. 技术描述

- **前端**：React@18 + TypeScript + Vite + TailwindCSS@3
- **初始化工具**：Vite
- **后端**：Go 1.21 + Gin Web框架
- **P2P协议**：WebTorrent + WebRTC
- **数据存储**：文件系统存储分片，内存缓存节点状态
- **哈希算法**：SHA-1 分片校验

## 3. 路由定义

### 前端路由
| 路由 | 用途 |
|------|------|
| / | 首页 - 资源列表和搜索 |
| /upload | 上传页面 - 文件上传和分片处理 |
| /download | 下载页面 - 磁力链接解析和下载 |
| /resource/:id | 资源详情页 |

### 后端API路由
| 路由 | 方法 | 用途 |
|------|------|------|
| /api/resource | POST | 上传文件创建资源 |
| /api/resource | GET | 获取资源列表 |
| /api/resource/:id | GET | 获取资源详情 |
| /api/resource/:id/chunks | GET | 获取分片信息 |
| /api/tracker/announce | GET | Tracker节点上报 |
| /api/tracker/scrape | GET | 获取节点列表 |
| /api/heartbeat | POST | 节点心跳 |

## 4. API 定义

```typescript
// 资源类型定义
interface Resource {
  id: string;
  name: string;
  size: number;
  chunkCount: number;
  chunkSize: number;
  infoHash: string;
  magnetLink: string;
  chunks: ChunkInfo[];
  createdAt: string;
  downloadCount: number;
  seeders: number;
  leechers: number;
  hotScore: number;
}

interface ChunkInfo {
  index: number;
  hash: string;
  size: number;
}

interface Peer {
  id: string;
  ip: string;
  port: number;
  isSeeder: boolean;
  lastSeen: string;
  downloaded: number;
  uploaded: number;
}

// 请求/响应定义
interface UploadResponse {
  success: boolean;
  resource: Resource;
  magnetLink: string;
}

interface AnnounceRequest {
  info_hash: string;
  peer_id: string;
  port: number;
  uploaded: number;
  downloaded: number;
  left: number;
  event: string;
}

interface AnnounceResponse {
  interval: number;
  peers: Peer[];
}
```

## 5. 服务端架构图

```mermaid
graph LR
    API["Gin API Handler"] --> CTRL["Controller层"]
    CTRL --> SVC["Service层"]
    SVC --> REPO["Repository层"]
    REPO --> STORE["存储层"]
    
    subgraph "Service层"
        RES["ResourceService"]
        TRK["TrackerService"]
        HB["HeartbeatService"]
        HOT["HotScoreService"]
    end
    
    subgraph "存储层"
        FS["文件系统"]
        MEM["内存缓存"]
    end
```

## 6. 数据模型

### 6.1 数据模型定义

```mermaid
erDiagram
    RESOURCE ||--o{ CHUNK : contains
    RESOURCE ||--o{ PEER : has
    PEER ||--o{ CHUNK : has
    
    RESOURCE {
        string id PK
        string name
        int64 size
        int chunk_count
        string info_hash
        string magnet_link
        datetime created_at
        int download_count
        float hot_score
    }
    
    CHUNK {
        int index PK
        string resource_id FK
        string sha1_hash
        int size
    }
    
    PEER {
        string id PK
        string resource_id FK
        string ip
        int port
        boolean is_seeder
        datetime last_seen
        int64 uploaded
        int64 downloaded
    }
```

### 6.2 热度排序算法
```
热度评分公式:
hotScore = (downloadCount * 0.6 + seeders * 0.3 + leechers * 0.1) / sqrt(hoursSinceCreated + 2)^1.5
```
