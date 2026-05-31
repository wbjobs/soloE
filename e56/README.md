# 实时股票回测系统

基于Python + FastAPI后端 + Streamlit前端的事件驱动股票回测系统。

## 功能特性

✅ **数据导入**：支持CSV格式的OHLCV历史数据导入
✅ **事件驱动引擎**：逐Tick回放，模拟真实交易场景
✅ **策略支持**：
  - 移动平均线金叉死叉策略 (MA Cross)
  - RSI策略
✅ **多资产组合回测**：同时回测多只股票
✅ **滑点和手续费模型**：
  - 固定滑点/百分比滑点/随机滑点
  - 百分比手续费/每股固定手续费/固定手续费
✅ **绩效分析**：
  - 收益率曲线
  - 最大回撤
  - 夏普比率
  - 年化收益率
  - 波动率
  - 胜率
✅ **可视化**：K线图、买卖点标记、权益曲线

## 项目结构

```
stock-backtest/
├── backend/
│   ├── __init__.py
│   ├── main.py                 # FastAPI后端
│   ├── engine/
│   │   ├── __init__.py
│   │   ├── data_handler.py    # 数据处理
│   │   ├── events.py          # 事件定义
│   │   ├── portfolio.py       # 投资组合
│   │   ├── broker.py          # 执行引擎（滑点/手续费）
│   │   ├── performance.py     # 绩效分析
│   │   └── backtest.py        # 回测引擎
│   └── strategies/
│       ├── __init__.py
│       ├── base_strategy.py   # 策略基类
│       ├── ma_cross.py        # MA金叉策略
│       └── rsi_strategy.py    # RSI策略
├── frontend/
│   └── app.py                 # Streamlit前端
├── examples/
│   ├── generate_sample_data.py # 示例数据生成
│   └── AAPL/MSFT/GOOG.csv    # 示例数据
├── data/                      # 数据目录
├── requirements.txt           # 依赖包
├── test_backtest.py           # 测试脚本
└── README.md
```

## 安装与运行

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 生成示例数据

```bash
python examples/generate_sample_data.py
```

这将在 `examples/` 目录下生成 AAPL.csv、MSFT.csv、GOOG.csv 三个示例数据文件。

### 3. 启动后端服务

```bash
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

后端API文档：http://localhost:8000/docs

### 4. 启动前端界面

在新的终端窗口运行：

```bash
streamlit run frontend/app.py
```

前端界面：http://localhost:8501

### 5. 运行测试（可选）

```bash
python test_backtest.py
```

这将测试两种策略和多资产组合回测。

## 使用说明

### Web界面使用

1. **上传数据**：
   - 打开前端界面，在「上传数据」页面
   - 输入股票代码（如AAPL）
   - 上传CSV文件，需包含 timestamp, open, high, low, close, volume 列
   - 点击「上传数据」

2. **配置回测**：
   - 在「回测配置」页面
   - 选择初始资金
   - 选择要回测的股票（可多选）
   - 选择策略类型：
     - 移动平均线金叉死叉策略：设置短期和长期均线周期
     - RSI策略：设置RSI周期和超买超卖阈值
   - 设置滑点和手续费参数
   - 点击「运行回测」

3. **查看结果**：
   - 关键绩效指标（总收益率、最大回撤、夏普比率等）
   - 权益曲线图
   - K线图与买卖点标记（绿色三角为买入，红色三角为卖出）
   - 交易记录

### 示例数据格式

CSV文件应包含以下列：

| timestamp | open | high | low | close | volume |
|-----------|------|------|-----|-------|--------|
| 2023-01-02 | 100.0 | 102.0 | 99.5 | 101.2 | 1000000 |
| 2023-01-03 | 101.5 | 103.0 | 100.8 | 102.5 | 1200000 |
| ... | ... | ... | ... | ... | ... |

## API接口

- `GET /` - API状态
- `GET /health` - 健康检查
- `POST /upload/{symbol}` - 上传股票数据
- `POST /backtest` - 运行回测
- `GET /strategies` - 获取可用策略列表
- `GET /uploaded-symbols` - 获取已上传的股票列表

## 策略说明

### 移动平均线金叉死叉策略

当短期均线上穿长期均线时买入，当短期均线下穿长期均线时卖出。

参数：
- short_window: 短期均线周期（默认5）
- long_window: 长期均线周期（默认20）

### RSI策略

当RSI低于超卖阈值时买入，当RSI高于超买阈值时卖出。

参数：
- period: RSI周期（默认14）
- overbought: 超买阈值（默认70）
- oversold: 超卖阈值（默认30）

## 交易成本模型

### 滑点模型

1. **固定滑点**：按固定基点计算
   - 参数：bps (基点)
   - 默认：5个基点（0.05%）

2. **百分比滑点**：按百分比计算
   - 参数：percentage

3. **随机滑点**：在0到最大基点之间随机

### 手续费模型

1. **百分比手续费**：按交易金额的百分比计算，有最低手续费
   - 参数：rate, min
   - 默认：rate=0.1%，min=¥1.0

2. **每股固定手续费**：按股数计算，有最低手续费
   - 参数：per_share, min

3. **固定手续费**：每笔交易固定费用
   - 参数：fixed

## 扩展开发

### 添加新策略

1. 在 `backend/strategies/` 目录下创建新策略类
2. 继承 `BaseStrategy` 类
3. 实现 `calculate_signals` 方法
4. 在 `backend/main.py` 中注册新策略

示例：
```python
from .base_strategy import BaseStrategy
from ..engine.events import MarketEvent, SignalEvent, SignalType

class MyStrategy(BaseStrategy):
    def __init__(self, symbols, param1, param2):
        super().__init__(symbols)
        self.param1 = param1
        self.param2 = param2
    
    def calculate_signals(self, event: MarketEvent) -> Optional[SignalEvent]:
        # 实现信号逻辑
        pass
```

### 自定义滑点/手续费模型

在 `backend/engine/broker.py` 中扩展 `SlippageModel` 或 `CommissionModel` 类。

## 性能指标说明

- **总收益率**：回测期间的总收益率
- **最大回撤**：从峰值到谷底的最大跌幅
- **夏普比率**：风险调整后收益指标，大于1较好
- **年化收益率**：按年计算的收益率
- **波动率**：收益率的标准差
- **胜率**：盈利交易占总交易的比例

## 许可证

MIT License
