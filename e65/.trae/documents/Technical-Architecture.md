## 1. 架构设计

```mermaid
graph TB
    subgraph "前端层"
        A["React UI组件"] --> B["Three.js渲染引擎"]
        B --> C["八叉树LOD管理器"]
        C --> D["点云数据缓存"]
        E["工具控制器"] --> B
        F["LAS/PLY解析器"] --> D
    end
    
    subgraph "后端服务层"
        G["Express API服务"] --> H["文件分块处理器"]
        H --> I["八叉树索引生成器"]
        I --> J["分块数据存储"]
        G --> K["分块数据API"]
    end
    
    subgraph "数据层"
        L["本地文件系统"] --> J
        M["内存缓存(Redis)"] --> K
    end
    
    D --> K
```

## 2. 技术描述

- **前端**: React@18 + TypeScript + Vite + TailwindCSS@3
- **状态管理**: Zustand
- **3D引擎**: three@0.160 + @react-three/fiber@8 + @react-three/drei@9
- **后端**: Express@4 + TypeScript
- **文件解析**: lasply + three.js内置PLY加载器
- **性能优化**: WebWorker + 分块加载 + 八叉树空间索引

## 3. 路由定义

| 路由 | 用途 |
|------|------|
| / | 主编辑器页面 |
| /api/pointcloud/upload | 点云文件上传接口 |
| /api/pointcloud/:id/chunks | 获取分块数据 |
| /api/pointcloud/:id/metadata | 获取点云元数据 |

## 4. API定义

### 4.1 类型定义

```typescript
// 点云元数据
interface PointCloudMetadata {
  id: string;
  name: string;
  format: 'las' | 'ply';
  totalPoints: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  hasRGB: boolean;
  hasIntensity: boolean;
  chunkCount: number;
}

// 八叉树节点
interface OctreeNode {
  id: string;
  level: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  pointCount: number;
  children: string[];
  lodLevels: number[];
}

// 分块数据
interface PointCloudChunk {
  nodeId: string;
  lodLevel: number;
  positions: Float32Array;
  colors?: Float32Array;
  intensities?: Float32Array;
  pointCount: number;
}

// 裁剪区域
interface ClipRegion {
  type: 'rectangle' | 'sphere' | 'polygon';
  parameters: any;
  inverse: boolean;
}
```

### 4.2 请求响应

```typescript
// POST /api/pointcloud/upload
// Request: multipart/form-data
// Response: PointCloudMetadata

// GET /api/pointcloud/:id/metadata
// Response: PointCloudMetadata

// GET /api/pointcloud/:id/chunks?lodLevel=2&bbox=...
// Response: PointCloudChunk[]
```

## 5. 服务器架构

```mermaid
graph LR
    A["API路由层"] --> B["文件上传控制器"]
    A --> C["分块数据控制器"]
    A --> D["元数据控制器"]
    
    B --> E["文件处理服务"]
    C --> F["八叉树查询服务"]
    D --> G["元数据服务"]
    
    E --> H["LAS/PLY解析器"]
    H --> I["八叉树构建器"]
    I --> J["分块存储管理器"]
    
    J --> K["文件系统存储"]
    F --> J
    G --> K
```

## 6. 数据模型

### 6.1 数据模型定义

```mermaid
erDiagram
    POINTCLOUD {
        string id PK
        string name
        string format
        int totalPoints
        float minX
        float minY
        float minZ
        float maxX
        float maxY
        float maxZ
        boolean hasRGB
        boolean hasIntensity
        int chunkCount
        datetime createdAt
    }
    
    OCTREE_NODE {
        string id PK
        string pointCloudId FK
        int level
        float minX
        float minY
        float minZ
        float maxX
        float maxY
        float maxZ
        int pointCount
        string parentId
    }
    
    CHUNK_DATA {
        string id PK
        string nodeId FK
        int lodLevel
        string dataPath
        int pointCount
    }
    
    POINTCLOUD ||--o{ OCTREE_NODE : contains
    OCTREE_NODE ||--o{ CHUNK_DATA : has
```

### 6.2 文件存储结构

```
data/
└── pointclouds/
    └── {pointcloud-id}/
        ├── metadata.json
        ├── octree.json
        └── chunks/
            ├── level-0/
            │   └── {node-id}.bin
            ├── level-1/
            └── level-2/
```
