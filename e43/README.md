# H.265 WebAssembly 视频播放器

基于 Vue3 + FFmpeg WebAssembly 的浏览器端 H.265 视频解码器。

## 功能特性

- 🎬 **WebAssembly 解码**：使用 FFmpeg 编译为 WASM 在浏览器端解码 H.265 视频
- 🧵 **多线程架构**：Web Worker 处理解码，主线程负责渲染，互不阻塞
- 🎨 **WebGL 渲染**：高性能 YUV 到 RGB 转换和渲染
- 🎮 **播放控制**：播放/暂停、逐帧步进、跳帧播放
- 📊 **性能监控**：实时显示解码帧率、渲染帧率、CPU 占用率
- 🔄 **分辨率切换**：支持 480p/720p/1080p 分辨率切换
- 📁 **格式支持**：支持 .mp4 和 .265/.h265 原始码流文件

## 项目结构

```
src/
├── main.js                 # 入口文件
├── App.vue                 # 根组件
├── style.css               # 全局样式
├── components/
│   └── H265Player.vue      # 播放器主组件
├── renderer/
│   └── yuv_renderer.js     # WebGL YUV 渲染器
├── worker/
│   └── decoder.worker.js   # 解码 Web Worker
└── wasm/
    ├── ffmpeg_wrapper.js   # FFmpeg WASM 封装 (模拟版)
    ├── ffmpeg_decoder.c    # FFmpeg 解码器 C 代码
    ├── build.sh            # 编译脚本
    └── README.md           # 编译说明
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 构建生产版本

```bash
npm run build
```

## 使用说明

### 1. 上传视频

点击播放器中央的上传区域，选择 H.265 编码的视频文件（.mp4 或 .265 格式）。

### 2. 播放控制

- **播放/暂停**：点击播放按钮
- **逐帧播放**：点击上一帧/下一帧按钮
- **跳帧**：拖动进度条到任意帧位置
- **分辨率切换**：在右上角选择分辨率

### 3. 性能监控

顶部实时显示：
- 解码帧率 (FPS)
- 渲染帧率 (FPS)
- CPU 占用率 (%)
- 帧队列大小

## 技术架构

### 解码流程

```
用户上传文件 
    ↓
FileReader 读取 ArrayBuffer
    ↓
Web Worker 接收数据
    ↓
FFmpeg WASM 解析 NALU
    ↓
avcodec_decode_video2 解码帧
    ↓
YUV 数据传递到主线程
    ↓
WebGL 着色器转换并渲染
    ↓
Canvas 显示视频帧
```

### 线程分离设计

- **解码线程 (Web Worker)**
  - FFmpeg WASM 实例运行
  - 码流解析和帧解码
  - 帧队列管理
  - 解码性能统计

- **渲染线程 (主线程)**
  - WebGL 渲染上下文
  - YUV->RGB 着色器转换
  - 画面显示和合成
  - 用户交互处理

## FFmpeg WASM 编译

### 环境要求

- Emscripten SDK
- FFmpeg 源码 (已配置为支持 H.265)
- CMake / Make

### 编译步骤

详见 `src/wasm/build.sh` 和 `src/wasm/README.md`

主要编译参数：
```bash
emcc ffmpeg_decoder.c \
  -s WASM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='createFFmpegModule' \
  --bind
```

## 当前版本说明

**注意**：当前版本中的 `ffmpeg_wrapper.js` 是一个模拟实现，用于演示架构。实际使用需要：

1. 按照 `src/wasm/` 目录下的说明编译 FFmpeg WASM
2. 将编译生成的 `.js` 和 `.wasm` 文件放入项目
3. 更新 `decoder.worker.js` 中的导入路径

## 浏览器支持

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

需要支持：
- WebAssembly
- WebGL
- Web Workers
- SharedArrayBuffer (可选)

## 性能优化建议

1. **启用 SIMD**：编译时添加 `-msimd128` 标志
2. **多线程解码**：使用 SharedArrayBuffer 和 Pthreads
3. **帧预加载**：提前解码几帧到缓冲区
4. **GPU 加速**：充分利用 WebGL 渲染管线
5. **内存池**：复用解码帧内存，减少 GC

## 许可证

MIT License
