# 3D 模型差异比较工具

基于 ICP（迭代最近点）配准算法的 3D 模型顶点差异分析工具，支持 OBJ 和 GLTF/GLB 格式。

## 功能特性

- 🎯 **双模型比较**: 同时加载两个 3D 模型进行顶点差异分析
- 📅 **时间轴动画**: 上传多个版本模型，用滑块滑动查看差异变化
- 📈 **RMS 趋势图**: 折线图显示整体差异随版本的变化趋势
- 🔄 **多种配准方法**: ICP（平移+旋转）和简单（平移+缩放）
- 🔥 **热力图可视化**: 差异大的区域显示红色，差异小的显示绿色
- 🌐 **Web 界面**: 基于 Vue + Three.js 的交互式 3D 视图
- 💻 **命令行工具**: 支持批量处理和脚本集成
- 📊 **详细统计**: 最小/最大/平均差异值，Top N 差异顶点
- ⚡ **实时进度**: WebSocket 推送处理进度通知
- 🛡️ **鲁棒性**: 自动处理 NaN 值，确保至少输出 5 个顶点坐标
- 📏 **自动采样**: 顶点数不一致的模型自动下采样到相同数量

## 项目结构

```
e78/
├── package.json          # 根项目配置
├── server/               # 后端服务
│   ├── package.json
│   ├── index.js          # Express 服务器主文件 (含 WebSocket)
│   ├── icp.js            # ICP 配准算法实现
│   ├── modelLoader.js    # OBJ/GLTF 模型加载器
│   ├── diffCalculator.js # 差异计算与热力图生成
│   └── uploads/          # 临时上传目录
├── client/               # 前端 Vue 应用
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.js
│       ├── App.vue       # 主应用组件
│       └── components/
│           ├── ModelViewer.vue        # Three.js 3D 视图组件
│           ├── PairResultViewer.vue   # 双模型比较结果组件
│           └── TimelineResultViewer.vue # 时间轴动画结果组件
├── cli/
│   └── diff-cli.js       # 命令行工具
└── README.md
```

## 快速开始

### 1. 安装依赖

```bash
# 安装根目录依赖
npm install

# 安装后端依赖
cd server && npm install && cd ..

# 安装前端依赖
cd client && npm install && cd ..
```

### 2. 启动 Web 应用

```bash
# 同时启动后端和前端开发服务器
npm run dev
```

或者分别启动：

```bash
# 启动后端服务 (端口 3000)
npm run server

# 启动前端开发服务器 (端口 5173)
npm run client
```

然后访问 http://localhost:5173

### 3. 使用命令行工具

```bash
# 基本用法
npm run cli -- model1.obj model2.glb

# 禁用 ICP 配准，显示前 10 个差异顶点
npm run cli -- model1.obj model2.obj --no-icp --top 10

# 指定采样点数，输出结果到 JSON 文件
npm run cli -- a.glb b.glb --samples 50000 --output result.json

# 查看帮助
npm run cli -- --help
```

## API 接口

### POST /api/compare

上传两个模型文件并比较差异。

**请求**: `multipart/form-data`
- `model1`: 第一个模型文件 (OBJ/GLTF/GLB)
- `model2`: 第二个模型文件 (OBJ/GLTF/GLB)
- `useICP`: 是否启用 ICP 配准 (默认: true)
- `sampleCount`: 顶点采样数量 (默认: 10000)

**响应**:
```json
{
  "success": true,
  "model1": { "name": "...", "vertexCount": 12345, "faceCount": 6789 },
  "model2": { "name": "...", "vertexCount": 12345, "faceCount": 6789 },
  "stats": {
    "minDistance": 0.000001,
    "maxDistance": 0.123456,
    "meanDistance": 0.012345
  },
  "topDifferences": [
    { "index": 1234, "vertex": [1.23, 4.56, 7.89], "distance": 0.123456 }
  ],
  "heatmap": {
    "colors": [{ "index": 0, "color": [255, 0, 0] }]
  },
  "usedICP": true
}
```

### POST /api/compare-paths

通过文件路径比较（适合服务器端使用）。

**请求**: `application/json`
```json
{
  "path1": "/path/to/model1.obj",
  "path2": "/path/to/model2.glb",
  "useICP": true,
  "sampleCount": 10000
}
```

## 技术说明

### 配准方法

#### ICP 配准（平移+旋转）
使用 SVD（奇异值分解）求解最优旋转矩阵，实现点云到点云的刚性配准。主要步骤：
1. 计算两个点集的质心并中心化
2. 寻找最近点对应关系
3. 计算交叉协方差矩阵
4. SVD 分解求解旋转矩阵
5. 计算平移向量
6. 迭代直到收敛

#### 简单配准（平移+缩放）
快速对齐方法，适用于形状相似、尺寸不同的模型：
1. 计算两个点集的质心
2. 计算两个点集的包围盒最大尺寸
3. 计算缩放比例
4. 应用缩放和平移

### 热力图颜色映射

```
绿色 (HSL 120°) → 黄色 (HSL 60°) → 红色 (HSL 0°)
    小差异                         大差异
```

### 性能考虑

- 顶点数超过 10,000 时自动降采样
- ICP 迭代次数限制为 30 次
- 支持的最大文件大小: 50MB

## 许可证

MIT
