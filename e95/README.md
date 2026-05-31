# 量子态模拟器 (Quantum State Simulator)

一个交互式量子计算可视化工具，支持最多 12 个量子比特的电路模拟。

## ✨ 功能特性

- **量子门支持**：H (Hadamard), X (Pauli-X), Y (Pauli-Y), S, T, CNOT
- **拖拽搭建**：直观的拖拽界面，轻松构建量子电路
- **态矢量可视化**：Plotly 柱状图展示实部、虚部和概率分布
- **布洛赫球**：单量子比特态的 3D 布洛赫球可视化
- **噪声模拟**：支持比特翻转、相位阻尼和去极化噪声
- **QASM 导出**：一键导出电路为 OpenQASM 2.0 格式
- **量子测量**：支持单个量子比特测量，观察波函数坍缩
- **最多 12 量子比特**：可模拟 2^12 = 4096 维态矢量

## 🏗️ 技术栈

### 后端
- **Python 3.10+**
- **FastAPI** - REST API 框架
- **NumPy** - 量子态矢量计算
- **Uvicorn** - ASGI 服务器

### 前端
- **Vue 3** + **TypeScript**
- **Vite** - 构建工具
- **Plotly.js** - 态矢量可视化
- **TailwindCSS 3** - 样式框架

## 🚀 快速开始

### 启动后端服务

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

API 文档：http://localhost:8000/docs

### 启动前端服务

```bash
cd frontend
npm install
npm run dev
```

访问：http://localhost:5173

## 📡 API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/state_vector?numQubits=N` | 获取初始态矢量 |
| POST | `/apply_gate` | 应用单个量子门 |
| POST | `/measure` | 测量指定量子比特 |
| POST | `/run_circuit` | 运行完整量子电路 |
| POST | `/reset` | 重置为 \|0⟩ 态 |
| GET | `/gates` | 获取支持的量子门列表 |

### API 返回格式

态矢量统一返回格式：
```json
{
  "state": {
    "real": [1.0, 0.0, 0.0, 0.0],
    "imag": [0.0, 0.0, 0.0, 0.0]
  },
  "numQubits": 2,
  "basisStates": ["|00⟩", "|01⟩", "|10⟩", "|11⟩"],
  "probabilities": [1.0, 0.0, 0.0, 0.0]
}
```

## 📖 使用说明

1. 从左侧工具箱拖拽量子门到电路画布上
2. CNOT 门需要先拖到控制位，再拖到目标位
3. 点击已放置的门可以删除
4. 调整量子比特数量（1-12）
5. 点击「运行电路」查看态矢量演化
6. 选择量子比特并点击「测量」观察波函数坍缩

## 🎯 示例电路

### 贝尔态 (Bell State)
```
q0: H --•--
        |
q1: ----⊕--
```
结果：(|00⟩ + |11⟩) / √2

### GHZ 态 (3 qubits)
```
q0: H --•----•--
        |    |
q1: ----⊕--  |
             |
q2: ---------⊕--
```
结果：(|000⟩ + |111⟩) / √2

## 📁 项目结构

```
e95/
├── backend/
│   ├── main.py           # FastAPI 应用入口
│   ├── quantum_sim.py    # 量子模拟器核心
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── GateToolbar.vue    # 量子门工具箱
│   │   │   ├── CircuitCanvas.vue  # 电路画布
│   │   │   ├── StatePlot.vue      # 态矢量图表
│   │   │   └── ControlPanel.vue   # 控制面板
│   │   ├── composables/
│   │   │   └── useQuantumAPI.ts   # API 封装
│   │   ├── types/
│   │   │   └── quantum.ts         # 类型定义
│   │   └── pages/
│   │       └── HomePage.vue       # 主页面
│   └── package.json
└── README.md
```

## 🔬 量子门矩阵

| 门 | 矩阵 |
|----|------|
| H | 1/√2 · [[1, 1], [1, -1]] |
| X | [[0, 1], [1, 0]] |
| Y | [[0, -i], [i, 0]] |
| S | [[1, 0], [0, i]] |
| T | [[1, 0], [0, e^(iπ/4)]] |
| CNOT | [[1,0,0,0],[0,1,0,0],[0,0,0,1],[0,0,1,0]] |
