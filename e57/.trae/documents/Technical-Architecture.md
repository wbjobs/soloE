# 分子结构3D可视化编辑器 - 技术架构文档

## 1. 系统架构

### 1.1 整体架构图
```
客户端浏览器                          后端服务器
+------------------+                  +----------------+
| React + TypeScript|                  | Flask API      |
| +--------------+  |   HTTP/REST      | +------------+ |
| | Three.js 3D  |  | <==============> | | PDB解析器  | |
| | 渲染引擎     |  |   JSON数据       | | Biopython  | |
| +--------------+  |                  | +------------+ |
| | 交互控制层   |  |                  | | 文件处理   | |
| +--------------+  |                  | +------------+ |
+------------------+                  +----------------+
```

## 2. 后端架构

### 2.1 目录结构
```
backend/
├── app.py                 # Flask应用入口
├── requirements.txt       # Python依赖
├── api/
│   └── pdb_parser.py      # PDB文件解析模块
└── uploads/               # 上传文件临时目录
```

### 2.2 API接口设计

#### POST /api/parse-pdb
- 功能：解析上传的PDB文件
- 请求：multipart/form-data，包含pdb文件
- 响应：
```json
{
  "success": true,
  "data": {
    "atoms": [...],
    "bonds": [...]
  }
}
```

### 2.3 PDB解析逻辑
1. 使用Biopython的PDB模块读取文件
2. 提取原子信息（元素、坐标、名称）
3. 基于原子距离计算化学键（阈值：1.8埃米）
4. 返回标准化JSON格式

## 3. 前端架构

### 3.1 目录结构
```
frontend/
├── package.json
├── tsconfig.json
├── public/
└── src/
    ├── App.tsx
    ├── main.tsx
    ├── components/
    │   ├── Viewer3D.tsx        # 3D视图组件
    │   ├── Header.tsx          # 顶部导航
    │   ├── Sidebar.tsx         # 侧边栏
    │   ├── AtomInfo.tsx        # 原子信息面板
    │   └── Measurement.tsx     # 测量结果面板
    ├── hooks/
    │   └── useMeasurement.ts   # 测量工具Hook
    ├── types/
    │   └── index.ts            # TypeScript类型定义
    └── utils/
        └── colors.ts           # 元素颜色映射
```

### 3.2 核心类型定义
```typescript
interface Atom {
  id: number;
  element: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

interface Bond {
  atom1: number;
  atom2: number;
}

interface MoleculeData {
  atoms: Atom[];
  bonds: Bond[];
}
```

## 4. Three.js渲染设计

### 4.1 场景结构
- Scene：主场景
  - AmbientLight：环境光
  - DirectionalLight：主光源
  - PerspectiveCamera：透视相机
  - Group：分子组
    - 原子球体（InstancedMesh优化性能）
    - 化学键圆柱体
  - OrbitControls：轨道控制器

### 4.2 渲染优化
- 使用InstancedMesh渲染大量原子
- 化学键使用圆柱体几何体复用
- 开启抗锯齿和阴影

## 5. 交互设计

### 5.1 射线检测
- 使用Raycaster进行原子拾取
- 鼠标点击时检测最近的原子

### 5.2 测量工具流程
1. 用户开启测量模式
2. 点击第一个原子（高亮）
3. 点击第二个原子（高亮）
4. 计算并显示距离
5. 绘制测量辅助线

## 6. 元素颜色映射
- C（碳）：#333333
- H（氢）：#FFFFFF
- O（氧）：#FF0000
- N（氮）：#0000FF
- S（硫）：#FFFF00
- P（磷）：#FFA500
- 其他：#FF00FF
