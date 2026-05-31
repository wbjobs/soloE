# 实时视频滤镜 - Rust + WebAssembly

基于 Rust 编译为 WebAssembly 的高性能实时视频滤镜应用，支持 1080p 视频实时处理。

## 功能特性

- 🎥 **实时摄像头视频流捕获**
- 🎨 **三种滤镜效果**：
  - 灰度滤镜 (Grayscale)
  - 复古滤镜 (Vintage)
  - Sobel 边缘检测 (Edge Detection)
- 🤖 **AI 人像背景虚化**：
  - 基于 MediaPipe Selfie Segmentation 轻量级模型
  - 仅对背景应用模糊，保持前景人像清晰
  - 可调节虚化强度 (3-30px)
  - 按需加载模型，不占用额外资源
- 🎚️ **滤镜强度调节** (0-100%)
- 📊 **实时性能监控** (FPS、处理时间)
- ⚡ **1080p 30fps+ 性能**

## 技术栈

### 后端 (WebAssembly)
- **Rust** - 系统级编程语言
- **wasm-bindgen** - Rust 与 JavaScript 互操作
- **web-sys** - Web API 绑定
- 整数运算优化 + 内存池 + 循环展开

### 前端
- **React 18** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Canvas API** - 视频渲染

## 性能优化

1. **整数运算替代浮点数**：使用定点数运算，避免浮点开销
2. **内存池**：使用 thread-local 缓存，避免频繁内存分配
3. **循环展开**：Sobel 算子手动展开，减少循环开销
4. **LTO 优化**：链接时优化，最大化编译器优化
5. **Canvas 优化**：使用 `willReadFrequently` 提示浏览器优化

## 快速开始

### 前置要求

- Node.js 18+
- Rust 1.70+
- wasm-pack

```bash
# 安装 wasm-pack
cargo install wasm-pack
```

### 安装依赖

```bash
npm install
```

### 编译 WebAssembly

```bash
npm run build:wasm
```

### 启动开发服务器

```bash
npm run dev
```

### 生产构建

```bash
npm run build
```

## 项目结构

```
.
├── src/
│   ├── lib.rs          # Rust Wasm 入口
│   ├── filters.rs      # 滤镜算法实现
│   ├── App.tsx         # React 主组件
│   ├── main.tsx        # React 入口
│   └── index.css       # 样式文件
├── pkg/                # 编译后的 Wasm 模块 (自动生成)
├── Cargo.toml          # Rust 依赖配置
├── package.json        # npm 依赖配置
├── vite.config.ts      # Vite 配置
└── index.html          # HTML 入口
```

## 滤镜算法说明

### 灰度滤镜 (Grayscale)
使用 ITU-R BT.601 标准的亮度公式：
```
Y = 0.299R + 0.587G + 0.114B
```
支持强度混合，可调节原图与灰度图的混合比例。

### 复古滤镜 (Vintage)
通过调整 RGB 通道权重，营造复古暖色调：
- 红色通道增强
- 绿色通道保持
- 蓝色通道减弱

### Sobel 边缘检测
使用 3x3 卷积核计算梯度：
```
Gx = [-1  0  1      Gy = [-1 -2 -1
      -2  0  2            0  0  0
      -1  0  1]           1  2  1]
```
梯度幅值：`|G| = sqrt(Gx² + Gy²)`

## 浏览器兼容性

- Chrome/Edge 90+
- Firefox 88+
- Safari 15+

需要支持：
- WebAssembly
- MediaDevices API (摄像头访问)
- Canvas API
- WebGL 2.0 (用于 AI 人像分割加速)

## 故障排除

### AI 模型加载失败
- 检查网络连接，模型需要从 CDN 下载 (~10MB)
- 确保浏览器支持 WebGL
- 尝试刷新页面重新加载

### 帧率过低
- 降低虚化强度 (推荐 10px 以下)
- 关闭其他占用 GPU 的标签页
- 尝试使用 Chrome/Edge 浏览器，WebGL 性能更好

### 人像分割不准确
- 确保光线充足，避免背光
- 人像与背景应有明显色差
- 保持人物在画面中央

## 许可证

MIT

## 许可证

MIT
