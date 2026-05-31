# Monte Carlo期权定价Web应用

基于Monte Carlo模拟的欧式期权定价工具，使用FastAPI后端和Streamlit前端。

## 功能特性

- 🎯 **期权定价**: 使用Monte Carlo模拟计算欧式看涨/看跌期权价格
- ⚡ **并行计算**: 使用`multiprocessing.Pool`充分利用CPU核心
- 📊 **希腊值**: 计算Delta, Gamma, Vega, Theta四个主要希腊值
- 📈 **可视化**: 
  - 实时进度条
  - 价格收敛曲线图
  - 标的资产价格分布直方图
- 🎛️ **参数可调**: 用户可灵活调整所有期权参数

## 项目结构

```
e46/
├── backend.py          # FastAPI后端 - Monte Carlo定价核心
├── frontend.py         # Streamlit前端 - 用户交互界面
├── requirements.txt    # Python依赖包
├── start_backend.bat   # Windows后端启动脚本
├── start_frontend.bat  # Windows前端启动脚本
└── README.md
```

## 核心算法

### Monte Carlo模拟

使用几何布朗运动(Geometric Brownian Motion)模拟标的资产价格路径：

```
dS_t = r*S_t*dt + σ*S_t*dW_t
```

其中:
- `S_t`: 标的资产价格
- `r`: 无风险利率
- `σ`: 波动率
- `W_t`: 维纳过程

### 希腊值计算

- **Delta**: ∂V/∂S - 价格对标的资产价格的一阶导数
- **Gamma**: ∂²V/∂S² - 价格对标的资产价格的二阶导数
- **Vega**: ∂V/∂σ - 价格对波动率的导数
- **Theta**: ∂V/∂t - 价格对时间的导数

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 启动后端服务

方式一: 使用批处理脚本
```bash
start_backend.bat
```

方式二: 直接运行Python
```bash
python backend.py
```

后端将在 `http://localhost:8000` 启动

### 3. 启动前端应用

方式一: 使用批处理脚本
```bash
start_frontend.bat
```

方式二: 直接运行Streamlit
```bash
streamlit run frontend.py
```

前端将在 `http://localhost:8501` 启动

### 4. 使用应用

1. 在浏览器中打开 `http://localhost:8501`
2. 在左侧输入期权参数:
   - 标的资产价格 (S)
   - 行权价格 (K)
   - 到期时间 (年)
   - 无风险利率 (%)
   - 波动率 (%)
   - 期权类型 (看涨/看跌)
   - 模拟次数
3. 点击"开始计算"按钮
4. 查看计算结果:
   - 期权价格
   - 希腊值
   - 收敛曲线
   - 价格分布直方图

## API接口

### POST /price-option

计算期权价格

**请求体**:
```json
{
  "S": 100.0,
  "K": 100.0,
  "T": 1.0,
  "r": 0.05,
  "sigma": 0.2,
  "option_type": "call",
  "num_simulations": 1000000
}
```

**响应**:
```json
{
  "option_price": 10.45,
  "greeks": {
    "delta": 0.6368,
    "gamma": 0.0187,
    "vega": 37.52,
    "theta": -6.23
  },
  "convergence": [...],
  "price_distribution": [...],
  "num_simulations": 1000000,
  "num_workers": 8
}
```

### GET /health

健康检查

## 技术栈

- **后端**: FastAPI + NumPy + multiprocessing
- **前端**: Streamlit + matplotlib
- **核心算法**: Monte Carlo模拟

## 并行计算实现

应用使用`multiprocessing.Pool`实现并行计算:
1. 将N次模拟任务平均分配到所有可用CPU核心
2. 每个进程独立执行一个模拟chunk
3. 最后聚合所有进程的结果

这种设计可以显著提升大规模模拟(如100万次)的计算速度。
