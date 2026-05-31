# 悬浮翻译球 (Hover Translator)

一个桌面悬浮球应用，鼠标悬浮在任意文本上0.5秒自动OCR识别并翻译，翻译结果调用本地 Ollama LLM 进行语法优化后显示。

## 功能特性

- 🎈 **悬浮球**: 可拖拽的桌面悬浮球，点击开启/关闭捕获，双击手动输入
- 👁️ **悬停识别**: 鼠标悬停在文本上0.5秒自动识别
- 📝 **OCR识别**: 使用 Tesseract 进行中英文文本识别
- 🌐 **双向翻译**: 支持中→英 / 英→中翻译切换
- 🤖 **LLM优化**: 调用本地 Ollama (llama3) 进行语法优化
- 💾 **本地缓存**: SQLite 缓存最近50条翻译记录
- 📋 **托盘控制**: 系统托盘图标快速切换语言和功能
- 🛡️ **优雅降级**: OCR初始化失败时自动切换到手动输入模式
- 🔄 **自动修复**: 支持自动下载缺失的 Tesseract 语言包
- 📚 **历史记录**: Ctrl+H 唤出历史记录窗口，支持搜索和重新翻译
- 🔇 **静默模式**: 隐藏悬浮球，仅通过快捷键使用翻译功能
- ⌨️ **快捷翻译**: Ctrl+Shift+T 快速打开翻译输入框

## 系统要求

- Windows 10/11
- Rust 1.75+
- Node.js (Tauri 依赖)
- Tesseract OCR (需安装并配置环境变量)
- Ollama (本地运行 LLM)

## 前置准备

### 1. 安装 Tesseract OCR

下载并安装 Tesseract: https://github.com/UB-Mannheim/tesseract/wiki

安装时请勾选中文语言包（chi_sim）。

确保将 Tesseract 添加到系统 PATH 环境变量。

*应用启动时会自动检测 Tesseract 和语言包，如果缺少语言包会提示自动下载。*

### 2. 安装并启动 Ollama

```powershell
# 安装 Ollama (https://ollama.com)
# 启动 Ollama 服务
ollama serve

# 拉取 llama3 模型
ollama pull llama3
```

## 开发运行

```powershell
# 安装依赖
cargo build

# 开发运行
cargo tauri dev

# 构建发布版本
cargo tauri build
```

## 使用说明

### 基本操作

1. 启动应用后，桌面会出现一个紫色悬浮球
2. **单击**悬浮球开启/关闭文本捕获功能
3. **双击**悬浮球或**右键**打开手动输入对话框
4. 开启捕获后，将鼠标悬停在任意文本上保持0.5秒
5. 系统会自动识别文本并翻译，翻译结果会显示在鼠标附近
6. 右键点击系统托盘图标可以切换翻译方向
7. 最近50条翻译记录会自动保存到本地

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + H` | 打开翻译历史窗口 |
| `Ctrl + Shift + T` | 打开快捷翻译输入框 |
| `Esc` | 关闭当前窗口 |

### 历史记录

- 按 `Ctrl+H` 或通过托盘菜单打开历史记录窗口
- 支持搜索原文、翻译、优化后的文本
- 每条记录可重新翻译或复制到剪贴板
- 支持一键清空所有历史记录

### 静默模式

- 通过托盘菜单开启"静默模式"
- 开启后悬浮球自动隐藏
- 翻译功能在后台继续运行
- 仅通过快捷键进行操作（Ctrl+H 查看历史，Ctrl+Shift+T 快速翻译）
- 再次点击托盘菜单关闭静默模式，悬浮球重新显示

### OCR 不可用时

- 悬浮球会变成红色/黄色，提示 OCR 状态
- 会显示友好的错误提示，不会导致应用崩溃
- 双击悬浮球或通过托盘菜单可以手动输入文本
- 可以点击"尝试修复"按钮自动下载缺失的语言包

## 项目结构

```
hover-translator/
├── src/
│   ├── main.rs          # 程序入口，Tauri 主进程
│   ├── lib.rs           # 库文件导出
│   ├── db.rs            # SQLite 数据库操作
│   ├── ocr.rs           # OCR 文本识别（含错误处理和自动下载）
│   ├── translator.rs    # Ollama LLM 翻译和优化
│   ├── capture.rs       # 屏幕捕获和鼠标悬停检测
│   ├── tray.rs          # 系统托盘菜单
│   └── hotkey.rs        # 全局快捷键监听
├── dist/
│   ├── index.html       # 悬浮球前端界面
│   ├── result.html      # 翻译结果界面
│   ├── manual-input.html# 手动输入对话框
│   └── history.html     # 翻译历史窗口
├── Cargo.toml           # Rust 依赖配置
└── tauri.conf.json      # Tauri 配置
```

## 技术栈

- **前端**: HTML + CSS + JavaScript + Tauri API
- **后端**: Rust + Tauri 2.0
- **OCR**: Tesseract
- **翻译**: Ollama + Llama 3
- **数据库**: SQLite (rusqlite)
- **屏幕捕获**: screenshots crate
- **HTTP客户端**: reqwest

## 配置

### 修改 Ollama 地址和模型

编辑 `src/translator.rs`:

```rust
pub fn new() -> Self {
    Self {
        client: Client::new(),
        ollama_url: "http://localhost:11434/api/generate".to_string(),
        model: "llama3".to_string(), // 可修改为其他模型
    }
}
```

### 修改悬停延迟

编辑 `src/capture.rs`:

```rust
if hover_time < Duration::from_millis(500) { // 修改此处
    return Ok(());
}
```

### 自定义语言包下载地址

编辑 `src/ocr.rs`:

```rust
let url = format!(
    "https://github.com/tesseract-ocr/tessdata/raw/main/{}.traineddata",
    lang
);
```

## 新功能说明

### OCR 优雅降级机制

1. **启动检测**: 应用启动时异步检测 Tesseract 安装和语言包
2. **状态反馈**: 悬浮球颜色变化反映 OCR 状态
   - 🟢 绿色：OCR 正常工作
   - 🟡 黄色：OCR 初始化中或临时不可用
   - 🔴 红色：OCR 不可用，需手动输入
3. **事件通知**: 通过事件系统向前端发送 OCR 状态变化
4. **自动恢复**: 提供一键修复功能，自动下载缺失的语言包

### 手动输入对话框

- 当 OCR 不可用时自动弹出或用户主动打开
- 支持输入任意文本进行翻译
- 显示错误原因和修复建议
- 提供"尝试修复"按钮自动下载语言包
- 实时显示下载进度

### 新增命令

- `retry_ocr_init`: 重新初始化 OCR 引擎
- `show_manual_input`: 显示手动输入对话框
- `get_ocr_status`: 获取当前 OCR 状态

## 常见问题

**Q: OCR 识别不准确怎么办？**
A: 确保安装了中文语言包，可以尝试调整捕获区域大小或 Tesseract 参数。

**Q: 翻译速度慢？**
A: LLM 推理速度取决于硬件性能，可以尝试使用更小的模型如 `llama3:8b`。

**Q: 如何清空历史记录？**
A: 删除 `%APPDATA%/hover_translator/translations.db` 文件。

**Q: OCR 初始化失败但我已经安装了 Tesseract？**
A: 请确保：
1. Tesseract 已添加到系统 PATH
2. 安装了中文语言包（chi_sim）
3. 可以在手动输入对话框点击"尝试修复"按钮自动下载语言包

**Q: 应用会崩溃吗？**
A: 不会。OCR 相关错误都被优雅处理，应用会切换到手动输入模式继续工作。
