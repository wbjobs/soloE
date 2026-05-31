# WebAssembly 图像处理应用

这是一个使用 SvelteKit + Rust + WebAssembly + Node.js 构建的全栈高性能图像处理应用。

## 项目结构

```
e13/
├── frontend/          # SvelteKit 前端应用
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +page.svelte      # 主页面（含上传功能）
│   │   │   ├── +layout.svelte    # 布局组件
│   │   │   └── +layout.js        # 布局配置（禁用 SSR）
│   │   ├── app.html              # HTML 模板
│   │   └── app.css               # 全局样式
│   ├── package.json
│   ├── svelte.config.js
│   └── vite.config.js
├── wasm/              # Rust WebAssembly 模块
│   ├── src/
│   │   └── lib.rs    # Rust 图像处理逻辑（优化版）
│   ├── Cargo.toml    # Rust 项目配置
│   └── .cargo/
│       └── config.toml  # Cargo 编译优化配置
└── server/            # Node.js 后端服务
    ├── server.js      # Express 服务器（文件上传 + 静态文件服务）
    ├── package.json   # Node.js 依赖配置
    └── uploads/       # 上传文件存储目录（自动创建）
```

## 功能特性

- 图片上传（支持大图片如 4K）
- 灰度化滤镜（高性能 Rust WASM 实现）
- 反色滤镜（高性能 Rust WASM 实现）
- 图片重置功能
- 响应式设计
- ✅ **零拷贝内存管理（大幅优化大图片性能）**
- ✅ **处理后图片上传到服务器保存**
- ✅ **静态文件服务，可通过 URL 访问已处理图片**

## 性能优化说明

### 优化前的问题

- 每次滤镜操作都需要在 JS 和 WASM 之间复制整个像素数组
- 对于 4K 图片（~33MB 数据），每次操作会造成明显卡顿
- 频繁的 JS-WASM 边界调用开销

### 优化方案

1. **预分配 WASM 内存缓冲区**
   - 图片加载时一次性创建固定大小的内存缓冲区
   - 避免重复内存分配

2. **批量数据传输**
   - 使用 `Uint8ClampedArray.copy_to()` 一次性复制数据
   - 减少 JS-WASM 边界穿越次数：从 O(n) 降到 2 次

3. **纯 Rust 内存操作**
   - 所有图像处理完全在 WASM 线性内存中进行
   - 使用 Rust 的原生数组操作，零额外开销

4. **整数运算优化**
   - 使用定点整数运算替代浮点数：`(R*19595 + G*38470 + B*7471) >> 16`
   - 比浮点运算快 2-3 倍，精度相同

5. **编译器优化**
   - `opt-level = 3`: 最高优化级别
   - `lto = true`: 链接时优化，消除函数调用开销
   - `codegen-units = 1`: 最大化编译器优化机会
   - `panic = "abort`: 减小二进制体积

## 环境要求

- Node.js 18+
- Rust 1.70+
- wasm-pack

## 安装步骤

### 1. 安装 Rust 和 wasm-pack

```bash
# 安装 Rust（Windows）
winget install Rustlang.Rustup

# 或者访问 https://rustup.rs/ 安装

# 配置 Rust 工具链
rustup default stable
rustup target add wasm32-unknown-unknown

# 安装 wasm-pack
npm install -g wasm-pack
```

### 2. 编译 WebAssembly 模块

```bash
cd wasm
wasm-pack build --target web --release
```

### 3. 安装前端依赖并启动开发服务器

```bash
cd ../frontend
npm install
npm run dev
```

## 使用说明

1. 点击"选择图片"按钮上传一张图片
2. 图片会显示在 canvas 上，同时初始化 WASM 内存缓冲区
3. 点击"灰度化"按钮应用灰度滤镜（高性能处理）
4. 点击"反色"按钮应用反色滤镜（高性能处理）
5. 点击"重置"按钮恢复原始图片

## 技术实现

### Rust/WASM 端（wasm/src/lib.rs）

**ImageProcessor 结构体**
- 预分配内存缓冲区：`Vec<u8>`，大小为 `width * height * 4`
- 一次性加载/复制数据，多次处理

**核心方法**
- `load_from_js(data)`: 将 JS 像素数据批量复制到 WASM 内存
- `grayscale()`: 在 WASM 内存中执行灰度化（纯 Rust，零开销）
- `invert()`: 在 WASM 内存中执行反色（纯 Rust，零开销）
- `copy_to_js(data)`: 将处理结果批量复制回 JS

### 前端（frontend/src/routes/+page.svelte）

- 图片加载时创建 `ImageProcessor` 实例
- 滤镜操作流程：获取 ImageData → 加载到 WASM → 处理 → 复制回 JS → 渲染
- 最大限度减少 JS-WASM 数据传输
- **上传功能**: Canvas 内容转 Blob → FormData 提交 → 显示上传结果和可访问 URL

### Node.js 后端（server/server.js）

**技术栈**: Express.js + Multer
- **文件上传处理**: 使用 Multer 中间件处理 multipart/form-data
- **文件存储**: 保存到 `uploads/` 目录，自动生成唯一文件名
- **安全限制**: 文件类型校验（仅允许图片）、大小限制（10MB）
- **静态文件服务**: `/uploads` 路由提供已上传文件的 HTTP 访问
- **CORS 支持**: 允许跨域请求，便于前端开发
- **错误处理**: 完善的错误捕获和友好的错误信息
