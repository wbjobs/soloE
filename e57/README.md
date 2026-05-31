# 分子结构3D可视化编辑器

基于Three.js + React + TypeScript + Flask的分子结构3D可视化编辑器。

## 功能特性

- 🧪 **PDB文件解析** - 支持加载PDB格式的蛋白质/小分子文件
- 🎨 **球棍模型渲染** - 按元素类型着色渲染原子和化学键
- 🖱️ **交互式3D视图** - 拖拽旋转、滚轮缩放、右键平移
- 🔬 **原子信息查看** - 点击原子显示元素信息和坐标
- 📏 **距离测量工具** - 点击两个原子显示埃米单位距离

## 技术栈

### 前端
- React 18.x
- TypeScript
- Three.js
- @react-three/fiber
- @react-three/drei
- Tailwind CSS
- Vite

### 后端
- Python 3.9+
- Flask
- Biopython (PDB解析)
- NumPy

## 快速开始

### 1. 启动后端服务

```bash
cd backend
pip install -r requirements.txt
python app.py
```

后端服务将在 http://localhost:5000 启动

### 2. 启动前端开发服务器

```bash
cd frontend
npm install
npm run dev
```

前端服务将在 http://localhost:3000 启动

## 使用说明

1. **加载分子结构
   - 点击"上传PDB文件"按钮
   - 选择PDB格式文件（examples目录中有示例文件

2. **3D视图操作
   - 鼠标左键拖拽：旋转视图
   - 鼠标滚轮：缩放视图
   - 鼠标右键拖拽：平移视图

3. **查看原子信息**
   - 点击任意原子
   - 右侧面板显示元素信息和坐标

4. **距离测量**
   - 点击"测量工具"按钮开启测量模式
   - 依次点击两个原子
   - 显示两原子间的埃米距离

## 项目结构

```
.
├── backend/                 # 后端Flask服务
│   ├── app.py             # Flask应用入口
│   ├── pdb_parser.py      # PDB文件解析模块
│   ├── requirements.txt    # Python依赖
│   └── uploads/           # 上传临时目录
├── frontend/                # 前端React应用
│   ├── src/
│   │   ├── components/    # React组件
│   │   ├── hooks/         # 自定义Hooks
│   │   ├── types/         # TypeScript类型定义
│   │   └── utils/         # 工具函数
│   ├── package.json
│   └── vite.config.ts
├── examples/                # 示例PDB文件
└── .trae/documents/        # 项目文档
```

## API接口

### POST /api/parse-pdb

解析上传的PDB文件

**请求:**
- `file: PDB文件

**响应:**
```json
{
  "success": true,
  "data": {
    "atoms": [
      {
        "id": 0,
        "element": "C",
        "name": "CA",
        "x": 0.0,
        "y": 0.0,
        "z": 0.0
      }
    ],
    "bonds": [
      {
        "atom1": 0,
        "atom2": 1
      }
    ]
  }
}
```
