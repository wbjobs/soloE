# 音频频谱可视化 - WebAssembly FFT

使用Rust和WebAssembly实现的音频频谱可视化项目。

## 功能特性

- 支持PCM音频数据的FFT（快速傅里叶变换）计算
- 解析WAV音频文件
- 使用Canvas绘制频谱柱状图
- 渐变色彩可视化效果

## 项目结构

```
.
├── src/
│   └── lib.rs          # Rust WebAssembly代码 (FFT实现)
├── Cargo.toml             # Rust项目配置
├── index.html            # 前端HTML页面
├── bootstrap.js          # 前端JavaScript代码
├── package.json          # npm脚本配置
└── README.md             # 项目说明
```

## 前置要求

1. **Rust工具链**: https://www.rust-lang.org/tools/install
2. **wasm-pack**: https://rustwasm.github.io/wasm-pack/installer/
   ```bash
   cargo install wasm-pack
   ```

## 构建和运行

### 方法1: 使用npm脚本

```bash
# 构建Wasm模块
npm run build

# 启动本地服务器
npm run serve

# 或者一键构建并启动
npm start
```

### 方法2: 手动构建

```bash
# 构建Wasm模块
wasm-pack build --target web --out-dir pkg

# 启动本地服务器（使用Python）
python -m http.server 8080

# 或使用Node.js的http-server
npx http-server -p 8080
```

启动服务器后，在浏览器中访问 `http://localhost:8080`

## 使用说明

1. 点击"选择WAV文件"按钮，选择一个.wav格式的音频文件
2. 文件加载成功后，点击"分析频谱"按钮
3. 在下方的Canvas将显示音频的频谱可视化

## 技术细节

### Rust Wasm模块提供两个函数：

- **compute_fft(pcm_data: &[f32]) -> Vec<f32>
  - 输入：PCM音频数据数组
  - 输出：频谱数据数组
  
- **next_power_of_two(n: usize) -> usize
  - 计算大于等于n的最小2的幂

### 支持的WAV格式：
  - PCM格式
  - 8位、16位、24位深度
  - 单声道或立体声

## 依赖库

- **wasm-bindgen**: Rust与JavaScript互操作
- **rustfft**: 快速傅里叶变换实现
- **num-complex**: 复数运算
