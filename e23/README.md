# Markdown Notes - Tauri 桌面应用

一个基于 Tauri、Preact 和 Rust 开发的跨平台 Markdown 笔记桌面应用，支持离线使用。

## 功能特性

- ✅ **本地数据库存储** - 使用 SQLite 存储所有笔记，完全离线可用
- ✅ **Markdown 编辑器** - 支持实时编辑和预览 Markdown 内容
- ✅ **自动保存** - 内容修改后自动保存到数据库
- ✅ **文件备份** - 支持将笔记备份到本地文件系统
- ✅ **深色主题** - 护眼的深色界面设计
- ✅ **跨平台** - 支持 Windows、macOS 和 Linux

## 技术栈

### 前端
- **Preact** - 轻量级 React 替代方案
- **TypeScript** - 类型安全的 JavaScript
- **Vite** - 快速的构建工具
- **Marked** - Markdown 解析库

### 后端
- **Rust** - 安全高效的系统编程语言
- **Tauri** - 跨平台桌面应用框架
- **rusqlite** - SQLite 数据库绑定
- **chrono** - 日期时间处理库

## 项目结构

```
markdown-notes/
├── src/                      # 前端源代码
│   ├── components/           # React 组件
│   │   ├── NoteList.tsx     # 笔记列表组件
│   │   ├── NoteList.css     # 笔记列表样式
│   │   ├── MarkdownEditor.tsx  # Markdown编辑器组件
│   │   └── MarkdownEditor.css  # Markdown编辑器样式
│   ├── types.ts             # TypeScript 类型定义
│   ├── api.ts               # Tauri 命令 API 封装
│   ├── backup.ts            # 文件备份功能
│   ├── App.tsx              # 主应用组件
│   ├── App.css              # 主应用样式
│   ├── main.tsx             # 应用入口
│   └── index.css            # 全局样式
├── src-tauri/               # Rust 后端代码
│   ├── src/
│   │   └── main.rs          # Rust 主程序
│   ├── Cargo.toml           # Rust 依赖配置
│   └── tauri.conf.json      # Tauri 配置
├── index.html               # HTML 入口
├── package.json             # Node.js 依赖
├── tsconfig.json            # TypeScript 配置
└── vite.config.ts           # Vite 配置
```

## 安装依赖

### 前置要求

1. **Node.js** (版本 18 或更高)
2. **Rust** (最新稳定版)
   - Windows: 需要安装 Visual Studio Build Tools
   - macOS: 需要安装 Xcode Command Line Tools
   - Linux: 需要安装 system dependencies

### 安装步骤

```bash
# 安装 Node.js 依赖
npm install
```

## 开发运行

```bash
# 启动开发服务器
npm run tauri dev
```

这将启动 Vite 开发服务器并打开 Tauri 应用窗口。

## 构建生产版本

```bash
# 构建生产应用
npm run tauri build
```

构建完成后，可在 `src-tauri/target/release/bundle/` 目录下找到安装包。

## 数据库说明

- 数据库文件存储在应用程序目录下的 `notes.db`
- 表结构包含: `id`, `title`, `content`, `last_modified`
- 所有操作都是本地操作，无需网络连接

## 备份功能

点击编辑器右上角的"备份"按钮，可以将当前笔记备份到系统文档目录下的 `markdown-notes-backup` 文件夹中，文件格式为 Markdown。

## 使用说明

1. **创建笔记** - 点击左侧"新建"按钮
2. **编辑笔记** - 在右侧编辑器中输入标题和内容
3. **切换预览** - 点击"预览"按钮查看渲染效果
4. **保存** - 自动保存，编辑后 1 秒自动保存
5. **删除笔记** - 鼠标悬停在笔记上，点击 × 按钮
6. **备份笔记** - 点击"备份"按钮保存到文件

## 离线使用

本应用完全支持离线使用：
- 所有数据存储在本地 SQLite 数据库
- 无需后端服务器
- 无需网络连接
- 所有操作即时响应
