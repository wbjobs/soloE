# 离线路径规划服务 (Offline Route Planner)

基于 OpenStreetMap PBF 数据的离线路径规划服务，使用 Node.js + Rust 扩展实现路径算法，React + MapLibre 提供前端交互。

## 功能特性

- 🌍 **离线路径规划**: 基于 OSM PBF 数据，无需联网即可规划路径
- ⚡ **高性能 Rust 核心**: 使用 Rust 实现 A* 和 Dijkstra 算法，性能优异
- 🗺️ **交互式地图**: 基于 MapLibre GL JS 的现代化地图界面
- 🚗 **车辆模拟**: 可调速度的车辆行驶模拟，实时更新位置
- 📍 **坐标吸附**: 将任意坐标自动吸附到最近的路网
- 🔄 **算法切换**: 支持 A* 和 Dijkstra 两种路径算法切换

## 技术架构

```
┌─────────────────┐     HTTP API     ┌─────────────────┐     FFI     ┌─────────────────┐
│   React 前端    │◄────────────────►│  Node.js 后端   │◄───────────►│   Rust 扩展     │
│  (MapLibre)     │                  │  (Express)      │             │ (N-API binding) │
└─────────────────┘                  └─────────────────┘             └─────────────────┘
                                                                           │
                                                                           ▼
                                                                  ┌─────────────────┐
                                                                  │  OSM PBF 解析   │
                                                                  │  路径算法引擎   │
                                                                  └─────────────────┘
```

## 项目结构

```
.
├── rust-ext/              # Rust 原生扩展
│   ├── src/
│   │   └── lib.rs        # 核心算法实现
│   ├── Cargo.toml
│   ├── package.json
│   └── build.rs
├── backend/               # Node.js 后端服务
│   ├── src/
│   │   └── server.js     # Express 服务器
│   ├── package.json
│   └── data/             # OSM PBF 数据目录
├── frontend/              # React 前端
│   ├── src/
│   │   ├── App.jsx       # 主应用组件
│   │   ├── main.jsx      # 入口文件
│   │   └── index.css     # 样式
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── package.json           # 根项目配置
```

## API 接口

### `GET /health`
健康检查接口，返回服务状态和图加载信息。

**响应:**
```json
{
  "status": "ok",
  "graphLoaded": true,
  "nodeCount": 12345,
  "edgeCount": 34567
}
```

### `POST /load`
加载 OSM PBF 数据文件。

**请求:**
```json
{
  "filename": "beijing.osm.pbf"
}
```

### `POST /snap`
将坐标吸附到最近的路网。

**请求:**
```json
{
  "lat": 39.9075,
  "lon": 116.3972
}
```

**响应:**
```json
{
  "success": true,
  "original": { "lat": 39.9075, "lon": 116.3972 },
  "snapped": { "lat": 39.9073, "lon": 116.3970 },
  "distance": 25.5
}
```

### `POST /route`
路径规划接口。

**请求:**
```json
{
  "start": { "lat": 39.9075, "lon": 116.3972 },
  "end": { "lat": 39.9175, "lon": 116.4072 },
  "algorithm": "astar"
}
```

- `algorithm`: `"astar"` (A*) 或 `"dijkstra"`

**响应:**
```json
{
  "success": true,
  "distance": 1523.5,
  "duration": 110.0,
  "path": [
    { "lat": 39.9075, "lon": 116.3972 },
    ...
  ],
  "nodes": [12345, 12346, ...],
  "algorithm": "astar"
}
```

### `POST /trip`
生成车辆行驶轨迹。

**请求:**
```json
{
  "path": [...],
  "speedKmh": 50,
  "intervalMs": 100
}
```

**响应:**
```json
{
  "success": true,
  "steps": [
    {
      "coord": { "lat": 39.9075, "lon": 116.3972 },
      "edge_index": 0,
      "progress": 0.0,
      "timestamp": 0,
      "speed": 50
    },
    ...
  ],
  "totalDuration": 15000,
  "stepCount": 150
}
```

### `GET /data/files`
列出可用的 OSM PBF 数据文件。

## 安装与运行

### 前置要求

- Node.js >= 16
- Rust 工具链 (stable)
- 构建工具 (Windows: MSVC, macOS: Xcode CLI, Linux: build-essential)

### 步骤 1: 安装依赖

```bash
# 安装根项目依赖
npm install

# 安装所有子项目依赖
npm run install:all
```

### 步骤 2: 编译 Rust 扩展

```bash
npm run build:rust
```

### 步骤 3: 准备 OSM 数据

1. 下载 OSM PBF 格式的地图数据，推荐来源:
   - [Geofabrik](https://download.geofabrik.de/) - 按地区下载
   - [Planet OSM](https://planet.openstreetmap.org/) - 全球数据

2. 将下载的 `.osm.pbf` 文件放入 `backend/data/` 目录

```bash
mkdir -p backend/data
# 将你的 osm.pbf 文件复制到 backend/data/ 目录
```

### 步骤 4: 启动服务

```bash
# 启动后端服务 (端口 3001)
cd backend
npm start

# 或在根目录运行
npm run dev:backend
```

```bash
# 启动前端开发服务器 (端口 3000)
cd frontend
npm run dev

# 或在根目录运行
npm run dev:frontend
```

```bash
# 同时启动前后端 (需要 concurrently)
npm run dev
```

### 步骤 5: 使用

1. 打开浏览器访问 `http://localhost:3000`
2. 在下拉框中选择 OSM PBF 文件，点击"加载数据"
3. 在地图上点击设置起点(绿色)和终点(红色)
4. 选择路径算法，点击"规划路径"
5. 调整行驶速度，点击"开始模拟行驶"

## Rust 核心实现说明

### 数据结构

- **`RoutingGraph`**: 路由图，存储节点和邻接表
- **`Coordinate`**: 经纬度坐标
- **`Node`**: OSM 节点 (ID + 坐标)
- **`Edge`**: 道路边 (起终点 + 距离 + 道路类型)

### 核心算法

1. **Dijkstra 算法**
   - 保证找到最短路径
   - 适合小范围路径规划
   - 时间复杂度 O(E log V)

2. **A* 算法**
   - 使用启发式函数引导搜索方向
   - 启发式: Haversine 距离 (球面距离)
   - 通常比 Dijkstra 快 2-5 倍
   - 同样保证最优性

### 坐标处理

- **Haversine 公式**: 计算地球表面两点之间的球面距离
- **点到线段距离**: 用于坐标吸附功能
- **线性插值**: 生成车辆行驶轨迹

## 性能优化

- Rust 原生代码实现，性能优于纯 JavaScript
- 使用 `priority-queue` 实现高效的优先队列
- 邻接表存储图结构，节省内存
- N-API 零拷贝数据传递
- 支持双向边 (无向图)，适合道路网络

## 支持的道路类型

- motorway, trunk, primary, secondary, tertiary
- unclassified, residential, service
- motorway_link, trunk_link, primary_link
- secondary_link, tertiary_link
- living_street, road

## 常见问题

### Q: 加载数据后图中节点数为 0？
A: 请检查 PBF 文件是否包含 `highway` 标签的道路。某些小型测试文件可能只包含边界数据。

### Q: 路径规划失败，显示"No path found"？
A: 可能的原因:
   1. 起点和终点之间没有连通的道路
   2. 数据中存在孤立的道路片段
   3. 坐标点离道路太远

### Q: Rust 编译失败？
A: 请确保:
   1. 已安装最新稳定版 Rust (`rustup update stable`)
   2. Windows 用户需安装 Visual Studio Build Tools
   3. 有足够的内存 (建议 >= 8GB)

### Q: 内存使用很高？
A: OSM 数据加载到内存中会占用较多空间。大城市数据通常需要 1-4GB 内存。建议从较小的区域开始测试。

## 开发建议

1. **从小数据开始**: 先使用小城市或区县的 PBF 文件测试
2. **预处理数据**: 使用 Osmium 等工具裁剪需要的区域
3. **监控性能**: A* 算法通常比 Dijkstra 快，优先使用
4. **缓存结果**: 对于频繁查询的路径，可以考虑缓存结果

## 扩展方向

- [ ] 支持转弯限制
- [ ] 加入实时交通数据
- [ ] 多种交通模式 (步行、自行车、公交)
- [ ] 海拔高度和坡度考虑
- [ ] 批量路径规划
- [ ] 距离矩阵计算
- [ ] 地图匹配 (Map Matching)

## 许可证

MIT License
