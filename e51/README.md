# WebRTC多人音视频会议系统

基于mediasoup的SFU架构WebRTC多人视频会议系统，支持最多6人同时在线。

## 技术栈

### 后端
- Node.js + Express
- mediasoup (SFU服务器)
- Socket.IO (信令通信)
- HTTPS (自签名证书)

### 前端
- Vue 3 + Vite
- mediasoup-client
- Socket.IO-client

## 核心功能

1. **多人音视频通话**: 单个房间最多支持6人同时参与
2. **SFU选择性转发**: 媒体流通过SFU服务器选择性转发，而非P2P广播
3. **动态码率自适应**: 根据网络状况自动调整视频分辨率和帧率
4. **实时质量监测**: 实时显示当前码率、分辨率、帧率信息
5. **音视频开关控制**: 可随时开启/关闭摄像头和麦克风

## 项目结构

```
e51/
├── backend/           # 后端服务器
│   ├── src/
│   │   ├── server.js    # 主服务器 + mediasoup SFU
│   │   └── config.js    # 配置文件
│   └── package.json
├── frontend/          # 前端应用
│   ├── src/
│   │   ├── App.vue      # 主组件
│   │   ├── main.js      # 入口文件
│   │   └── services/
│   │       └── webrtcService.js  # WebRTC核心服务
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── certs/             # HTTPS证书目录
    └── cert.pfx
```

## 运行环境要求

- **Node.js >= 16.x** (推荐 18.x 或 20.x)
- **Python 3.x** (mediasoup编译需要)
- **make/Visual Studio Build Tools** (Windows编译mediasoup需要)

### 重要: Windows环境下mediasoup安装说明

mediasoup在Windows上编译需要以下工具：
1. Visual Studio 2019/2022 (带C++桌面开发工具)
2. Python 3.8+

如果安装遇到问题，推荐使用 WSL (Windows Subsystem for Linux) 运行后端。

## 安装与运行

### 1. 安装后端依赖

```bash
cd backend
npm install
```

### 2. 安装前端依赖

```bash
cd frontend
npm install
```

### 3. 启动后端服务器

```bash
cd backend
node src/server.js
```

服务器将在 `https://localhost:3001` 启动

### 4. 启动前端开发服务器

```bash
cd frontend
npm run dev
```

前端将在 `https://localhost:5173` 启动

## 使用说明

1. 打开浏览器访问 `https://localhost:5173`
2. 输入房间号和昵称，点击"加入会议"
3. 浏览器会请求摄像头和麦克风权限，请允许
4. 多人使用相同的房间号即可加入同一个会议
5. 使用底部控制栏可开关摄像头/麦克风

## 动态码率自适应算法说明

系统通过以下机制实现码率自适应：

1. **网络质量监测**: 监听producer/consumer的score值（0-10分）
2. **滑动窗口平均**: 取最近10个分数样本计算平均值
3. **分级调整策略**:
   - 平均分 >= 9: 提升码率 15%
   - 平均分 >= 7: 提升码率 5%
   - 平均分 < 5: 降低码率 30%
   - 平均分 < 3: 降低码率 50%
4. **视频参数调整**: 根据码率自动选择合适的分辨率和帧率
   - < 0.5 Mbps: 360p @ 15fps
   - 0.5-1.0 Mbps: 480p @ 24fps
   - 1.0-1.8 Mbps: 720p @ 30fps
   - > 1.8 Mbps: 1080p @ 30fps

## SFU选择性转发机制

1. **发布端**: 每个参与者只发送一份媒体流到SFU服务器
2. **订阅端**: 其他参与者通过SFU订阅需要的媒体流
3. **优势**:
   - 节省上行带宽（相比Mesh P2P架构）
   - 支持更多参与者同时在线
   - 服务器可实现流控制和质量调整
   - 便于录制和转码等扩展功能

## 注意事项

1. 使用自签名证书，浏览器会提示"不安全"，选择"高级"->"继续前往"即可
2. 首次访问需要授予摄像头和麦克风权限
3. 建议使用Chrome或Edge浏览器获得最佳体验
4. mediasoup worker会占用较多CPU，建议在性能较好的机器上运行

## 故障排查

### 后端安装mediasoup失败
- 确保安装了Python 3.x和Visual Studio C++工具
- 或使用WSL/Linux环境运行

### 视频无法显示
- 检查摄像头权限是否已授予
- 确保HTTPS正确加载
- 查看浏览器控制台错误信息

### 无法连接其他用户
- 确保后端服务器正常运行
- 检查防火墙设置
- 确认两人使用相同的房间号
