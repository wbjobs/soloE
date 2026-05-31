# 以太坊交易追踪系统

一个基于 Node.js + Express 后端和 React + ECharts 前端的以太坊测试网交易追踪系统。

## 功能特性

- ✅ 输入钱包地址，查询最近 100 笔交易
- ✅ 交易流向桑基图可视化
- ✅ Gas 费用趋势折线图
- ✅ 交易时间轴可视化
- ✅ 高亮标记与合约交互的交易
- ✅ SQLite 数据缓存，避免重复 RPC 调用
- ✅ 交易详情列表，支持直接跳转到 Etherscan

## 项目结构

```
eth-tracker/
├── backend/                 # 后端服务
│   ├── server.js           # Express 服务器入口
│   ├── ethService.js       # Web3.js 以太坊交互
│   ├── database.js         # SQLite 数据库操作
│   ├── package.json        # 后端依赖配置
│   └── .env               # 环境变量
└── frontend/               # 前端应用
    ├── src/
    │   ├── App.js         # 主应用组件
    │   ├── App.css        # 样式文件
    │   ├── index.js       # 入口文件
    │   └── components/    # 组件目录
    │       ├── SankeyChart.js      # 桑基图组件
    │       ├── GasTrendChart.js    # Gas 趋势图组件
    │       ├── Timeline.js          # 时间轴组件
    │       └── TransactionList.js   # 交易列表组件
    ├── public/
    │   └── index.html     # HTML 模板
    └── package.json       # 前端依赖配置
```

## 快速开始

### 环境要求

- Node.js >= 16.0.0
- npm 或 yarn

### 后端启动

```bash
cd backend
npm install
npm start
```

后端服务将在 http://localhost:3001 启动

### 前端启动

```bash
cd frontend
npm install
npm start
```

前端应用将在 http://localhost:3000 启动

## API 接口

### 获取地址交易

```
GET /api/transactions/:address?limit=100
```

**参数:**
- `address`: 以太坊钱包地址 (必需)
- `limit`: 返回交易数量 (可选，默认 100)
- `refresh`: 是否强制刷新缓存 (可选)

**响应示例:**
```json
{
  "transactions": [
    {
      "hash": "0x...",
      "blockNumber": 1234567,
      "timestamp": 1234567890,
      "from": "0x...",
      "to": "0x...",
      "value": "1000000000000000000",
      "gasPrice": "1000000000",
      "gasUsed": 21000,
      "isContractInteraction": false,
      "input": "0x"
    }
  ],
  "fromCache": true,
  "count": 100
}
```

### 健康检查

```
GET /api/health
```

## 技术栈

### 后端
- **Express**: Web 框架
- **Web3.js**: 以太坊 RPC 交互
- **SQLite3**: 本地缓存数据库
- **CORS**: 跨域资源共享

### 前端
- **React**: UI 框架
- **ECharts**: 数据可视化库
- **echarts-for-react**: React ECharts 封装
- **Axios**: HTTP 客户端

## 缓存机制

系统使用 SQLite 作为本地缓存：

1. 首次查询地址时，从 RPC 节点获取数据并缓存
2. 后续查询同一地址时，优先从缓存返回
3. 点击"刷新数据"按钮可强制从 RPC 节点获取最新数据
4. 缓存数据包括地址信息和交易详情

## 可视化说明

### 桑基图
- 展示交易流向，当前地址为中心节点
- **蓝色连线**: 普通交易
- **橙色连线**: 合约交互交易

### Gas 趋势图
- 蓝色折线: Gas Price 变化趋势 (Gwei)
- 紫色柱状: Gas Used
- 橙色标记点: 合约交互交易

### 时间轴
- 散点图展示交易分布
- 橙色大点: 合约交互
- 蓝色小点: 普通交易

## NFT 交易识别

系统支持自动识别以太坊 NFT 交易：

### 支持的标准
- **ERC-721**: 标准 NFT (非同质化代币)
- **ERC-1155**: 多标准 NFT (半同质化代币)

### 识别机制
- 通过分析交易 `input` 数据中的方法签名识别
- ERC-721 `Transfer` 事件签名: `0xddf252ad...`
- ERC-1155 `TransferSingle` 和 `TransferBatch` 事件签名
- 识别结果存储在数据库中，支持查询

### 可视化展示

| 组件 | NFT 展示效果 |
|------|-------------|
| **交易列表** | ERC-721: 粉色渐变标签 + 粉色行背景<br>ERC-1155: 紫色渐变标签 + 粉色行背景 |
| **桑基图** | ERC-721: 粉色连接线 (#ff6b9d)<br>ERC-1155: 紫色连接线 (#a29bfe) |
| **Gas 趋势图** | 提示框显示 🎴 图标 + 颜色标识 |
| **时间轴** | 更大的散点 + 对应颜色标识 |
| **统计栏** | NFT 交易数量使用渐变色显示 |

## 性能优化

### 桑基图优化
- **交易聚合**: 按交易对手地址聚合，而不是单笔交易渲染
- **Top N 显示**: 默认仅显示交易量最大的前 15 个对手
- **"其他"聚合**: 小额交易聚合为"其他流入"和"其他流出"
- **切换按钮**: 支持"显示前15个"/"显示全部"切换
- **Canvas 渲染**: 使用 Canvas 而非 SVG 提升渲染性能

### 列表分页
- **后端分页**: 新增 `/paginated` 接口支持服务器端分页
- **前端分页控件**: 支持页码跳转、每页条数选择
- **加载状态**: 分页加载时显示 loading 指示器
- **表头固定**: 滚动时表头保持可见

### 缓存机制
- **SQLite 持久化缓存**: 避免重复 RPC 调用
- **并行请求**: 图表数据和列表数据并行请求

## 注意事项

1. 默认使用 Sepolia 测试网 RPC 节点
2. 查询大量交易可能需要较长时间
3. 建议使用自己的 RPC 节点以提高稳定性（修改 `.env` 中的 `RPC_URL`）
4. 图表最多显示 100 笔交易，完整列表通过分页查看

## 测试地址示例

可使用以下 Sepolia 测试网地址进行测试：
- `0x71C7656EC7ab88b098defB751B7401B5f6d8976F` (Vitalik 测试地址)
- 或其他有交易记录的 Sepolia 地址
