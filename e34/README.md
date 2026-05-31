# eBPF服务拓扑自动发现系统

基于eBPF的服务拓扑自动发现与可视化系统，实时监控服务间网络调用关系。

## 架构

- **Agent**: Python + BCC 采集系统调用，识别TCP/UDP网络连接
- **Backend**: FastAPI + PostgreSQL 数据存储与API服务
- **Frontend**: React + AntV G6 动态服务拓扑可视化

## 快速开始

### 1. 启动后端和前端

```bash
docker-compose up -d
```

### 2. 访问服务

- 前端: http://localhost:3000
- 后端API: http://localhost:8000
- API文档: http://localhost:8000/docs

### 3. 生成模拟数据（测试用）

```bash
cd backend
pip install requests
python mock_data.py
```

### 4. 运行eBPF Agent（需要Linux环境和root权限）

```bash
cd agent
pip install -r requirements.txt
sudo python ebpf_collector.py
```

## 模块说明

### Agent
- 使用eBPF hook `tcp_connect` 和 `udp_sendmsg` 采集连接事件
- 自动识别源进程名称和PID
- 聚合连接统计数据，定时上报
- 支持TCP和UDP协议

### Backend
- RESTful API接收Agent上报数据
- PostgreSQL持久化存储连接记录
- 按时间范围查询拓扑接口
- 自动聚合服务节点和调用关系

### Frontend
- AntV G6力导向布局渲染动态拓扑图
- 节点大小表示服务流量权重
- 边粗细表示调用频率
- TCP/UDP协议颜色区分
- 时间滑块回溯任意历史时刻
- 自动播放历史变化
- 支持拖拽、缩放交互

## API接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/connections | 上报连接数据 |
| GET | /api/topology | 获取服务拓扑 |
| GET | /api/time-range | 获取数据时间范围 |
| GET | /api/health | 健康检查 |

## 项目结构

```
.
├── agent/                  # eBPF数据采集Agent
│   ├── ebpf_collector.py  # 主程序
│   ├── requirements.txt    # Python依赖
│   └── Dockerfile
├── backend/                # FastAPI后端服务
│   ├── main.py            # 主程序
│   ├── mock_data.py       # 模拟数据生成器
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/               # React前端
│   ├── src/
│   │   ├── App.js         # 拓扑图组件
│   │   ├── index.js       # 入口
│   │   └── index.css      # 样式
│   ├── public/
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml      # Docker编排
└── README.md
```

## 系统要求

- **Agent**: Linux Kernel >= 4.15, root权限
- **Docker**: Docker Engine >= 20.10, Docker Compose >= 2.0
- **内存**: 至少2GB可用内存

