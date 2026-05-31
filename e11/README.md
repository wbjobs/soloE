# EncryptFS - 本地加密文件系统

一个基于 Tauri v2 + React + TypeScript 开发的本地文件加密应用，使用 AES-256-GCM 算法对文件进行加密保护。

## 功能特性

- 📁 **文件浏览器**: 选择文件夹，浏览所有文件
- 🔒 **单个/批量加密**: 对未加密文件进行 AES-256-GCM 加密
- 🔓 **解密功能**: 使用密码解密已加密文件
- 💾 **安全替换**: 加密后原文件被替换为 .enc 后缀的加密文件
- 🎨 **现代 UI**: 使用 Shadcn/ui + Tailwind CSS 构建
- 📊 **状态管理**: Zustand 管理应用状态

## 技术栈

### 后端 (Rust)
- **Tauri v2**: 桌面应用框架
- **aes-gcm**: AES-256-GCM 加密算法
- **pbkdf2**: 密钥派生函数
- **sha2**: SHA-256 哈希算法
- **rand**: 安全随机数生成

### 前端 (React + TypeScript)
- **React 18**: UI 框架
- **TypeScript**: 类型安全
- **Zustand**: 状态管理
- **Shadcn/ui**: UI 组件库
- **Tailwind CSS**: 样式框架
- **Vite**: 构建工具

## 快速开始

### 前置要求

- Node.js >= 20.9.0
- Rust >= 1.70.0
- 系统依赖 (Windows 无需额外安装)

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建生产版本

```bash
npm run tauri build
```

## 使用说明

1. **选择文件夹**: 点击"选择文件夹"按钮，选择要加密/解密文件所在的文件夹
2. **选择文件**: 在文件列表中勾选要操作的文件
3. **加密/解密**:
   - 选择未加密文件 → 点击"加密"按钮 → 输入密码
   - 选择已加密文件 (.enc 后缀) → 点击"解密"按钮 → 输入密码
4. **等待完成**: 操作完成后文件列表会自动刷新

## 加密原理

- 使用 **AES-256-GCM** 算法进行对称加密
- 使用 **PBKDF2** 从用户密码派生加密密钥（100,000 次迭代）
- 每个文件使用唯一的 16 字节 salt 和 12 字节 nonce
- 加密文件格式: `[salt][nonce][ciphertext]`
- 加密后的文件以 `.enc` 为后缀

## 项目结构

```
.
├── src/                      # 前端代码
│   ├── components/
│   │   ├── ui/              # Shadcn/ui 组件
│   │   ├── FileBrowser.tsx  # 文件浏览器主组件
│   │   └── PasswordDialog.tsx # 密码输入对话框
│   ├── store/
│   │   └── fileStore.ts     # Zustand 状态管理
│   ├── lib/
│   │   └── utils.ts         # 工具函数
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── src-tauri/               # Rust 后端代码
│   ├── src/
│   │   ├── crypto.rs        # 加密解密核心逻辑
│   │   └── lib.rs           # Tauri 命令和主入口
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
```

## 安全提示

- ⚠️ 请牢记您的加密密码，密码丢失将无法恢复文件
- ⚠️ 建议在加密前备份重要文件
- ⚠️ 使用强密码以提高安全性

## 许可证

MIT
