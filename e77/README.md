# 微电网P2P能量交易系统

一个基于Django + DRF + React的全栈应用，模拟微电网环境下的P2P能量交易。

## 功能特性

### 后端 (Django + DRF)
- **5个节点模拟**：每个节点具有太阳能发电和负载
- **双边拍卖算法**：每10秒自动进行一次拍卖结算
- **智能匹配**：买方按出价从高到低排序，卖方按报价从低到高排序，自动匹配交易
- **RESTful API**：完整的节点、竞价、交易、拍卖结果API接口
- **定时任务**：APScheduler实现每10秒自动结算

### 前端 (React + React Flow)
- **节点网络图**：使用react-flow可视化展示5个节点的网络拓扑
- **实时数据展示**：每个节点实时显示当前发电功率、负载功率和净功率
- **交易流向箭头**：动画箭头显示能量交易方向和数量
- **状态指示器**：
  - 🟢 绿色：卖方（发电 > 负载）
  - 🔴 红色：买方（发电 < 负载）
  - 🔵 蓝色：平衡（发电 ≈ 负载）
- **实时更新**：每10秒自动刷新数据，显示倒计时
- **侧边栏详情**：显示所有节点的详细数据和当前交易记录

## 项目结构

```
e77/
├── backend/                 # Django后端
│   ├── manage.py
│   ├── requirements.txt
│   ├── microgrid/          # 项目配置
│   │   ├── settings.py
│   │   ├── urls.py
│   │   └── ...
│   └── trading/            # 交易应用
│       ├── models.py       # 数据模型
│       ├── auction.py      # 双边拍卖算法
│       ├── views.py        # API视图
│       ├── urls.py         # 路由配置
│       ├── scheduler.py    # 定时任务
│       └── ...
└── frontend/               # React前端
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── App.jsx         # 主应用组件
        ├── App.css         # 样式
        └── ...
```

## 快速开始

### 1. 启动后端服务

```bash
cd backend
pip install -r requirements.txt
python manage.py makemigrations
python manage.py migrate
python manage.py init_nodes
python manage.py runserver 0.0.0.0:8000
```

后端服务将在 http://localhost:8000 启动

### 2. 启动前端服务

```bash
cd frontend
npm install
npm run dev
```

前端服务将在 http://localhost:3000 启动

### 3. 访问应用

打开浏览器访问 http://localhost:3000

## API接口

| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/grid-state/` | GET | 获取当前电网状态（节点、交易、拍卖结果） |
| `/api/trigger-auction/` | POST | 手动触发一次拍卖结算 |
| `/api/update-power/` | POST | 更新所有节点的功率数据 |
| `/api/nodes/` | GET/POST | 节点列表/创建节点 |
| `/api/nodes/<id>/` | GET/PUT/DELETE | 节点详情/更新/删除 |
| `/api/transactions/` | GET | 交易记录列表 |
| `/api/auction-results/` | GET | 拍卖结果列表 |
| `/api/bids/` | GET | 竞价记录列表 |

## 双边拍卖算法说明

1. **功率更新**：每次拍卖前随机更新每个节点的发电和负载
2. **竞价生成**：
   - 卖方：净功率为正，报价范围 0.3-1.0 元/kWh
   - 买方：净功率为负，出价范围 0.5-1.5 元/kWh
3. **排序匹配**：
   - 买方按出价从高到低排序
   - 卖方按报价从低到高排序
   - 当买方出价 ≥ 卖方报价时，匹配成功
4. **交易价格**：取买方出价和卖方报价的平均值
5. **交易数量**：取双方剩余量的较小值

## 技术栈

### 后端
- Django 4.2.7
- Django REST Framework 3.14.0
- APScheduler 3.10.4
- django-cors-headers

### 前端
- React 18.2.0
- React Flow 11.10.4
- Axios 1.6.2
- Vite 5.0.8
