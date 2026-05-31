# UEFI Boot Manager

一个使用 Tauri v2 + React 开发的跨平台 UEFI 启动项管理桌面应用。

## 功能特性

- 📋 **查看启动项列表** - 显示所有 UEFI 启动项的详细信息
  - 启动项名称
  - 分区路径
  - 磁盘设备
  - 激活状态
  - 启动顺序

- ➕ **管理启动项**
  - 添加新的 UEFI 启动项
  - 删除不需要的启动项
  - 通过上下移动调整启动顺序

- 💾 **备份与恢复**
  - 将 EFI 配置备份到 JSON 文件
  - 从备份文件恢复 EFI 配置

- 🎨 **现代 UI 设计**
  - 支持深色/浅色主题
  - 响应式布局
  - 流畅的动画效果

## 平台支持

| 平台 | 后端工具 | 状态 |
|------|---------|------|
| Linux | `efibootmgr` | ✅ 支持 |
| Windows | `bcdedit` | ✅ 支持 |
| macOS | (系统API) | ✅ 基础支持 |

## 技术栈

### 前端
- **React 18** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **CSS Variables** - 主题系统

### 后端 (Rust)
- **Tauri v2** - 桌面应用框架
- **tokio** - 异步运行时
- **serde** - 序列化/反序列化
- **regex** - 命令输出解析

## 开发指南

### 前置要求

1. **Node.js 20+** 和 npm
2. **Rust 1.70+** - 按照 [Rust 官方指南](https://www.rust-lang.org/tools/install) 安装
3. **系统依赖**
   - **Linux**: `sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
   - **Windows**: Visual Studio Build Tools + Windows 10/11 SDK
   - **macOS**: Xcode Command Line Tools `xcode-select --install`

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

这会同时启动 Vite 开发服务器和 Tauri 开发窗口。

### 构建生产版本

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 项目结构

```
uefi-boot-manager/
├── src/                          # 前端源码
│   ├── App.tsx                  # 主应用组件
│   ├── App.css                  # 应用样式
│   ├── main.tsx                 # 入口文件
│   └── index.css                # 全局样式
├── src-tauri/                    # Tauri 后端
│   ├── src/
│   │   ├── lib.rs               # 主库文件，Tauri 命令
│   │   └── efi.rs               # EFI 管理核心模块
│   ├── Cargo.toml               # Rust 依赖
│   ├── tauri.conf.json          # Tauri 配置
│   └── capabilities/            # Tauri 权限配置
├── package.json                  # npm 依赖
├── tsconfig.json                 # TypeScript 配置
└── vite.config.ts                # Vite 配置
```

## 核心模块说明

### EFI 管理器 (`efi.rs`)

实现跨平台 EFI 启动项管理：

- **`get_boot_entries()`** - 获取所有启动项
- **`add_boot_entry()`** - 添加新启动项
- **`delete_boot_entry()`** - 删除启动项
- **`set_boot_order()`** - 设置启动顺序
- **`backup_config()`** - 备份配置到文件
- **`restore_config()`** - 从文件恢复配置

### Tauri 命令 (`lib.rs`)

暴露给前端调用的异步命令：

- `get_boot_entries`
- `add_boot_entry`
- `delete_boot_entry`
- `set_boot_order`
- `backup_efi_config`
- `restore_efi_config`

## 权限说明

应用需要以下系统权限：

- **Linux**: `sudo` 权限才能修改 EFI NVRAM 变量
- **Windows**: 管理员权限运行
- **macOS**: SIP 可能需要部分禁用或使用 bless 命令

## 已知问题修复

### ✅ NVRAM 缓存导致启动顺序修改不生效

**问题描述**：
某些主板（尤其是华硕、技嘉、微星等消费级主板）会在内存中缓存 EFI NVRAM 变量，修改 BootOrder 后，如果不同步刷新缓存，重启后可能仍然使用旧的启动顺序。

**解决方案**：
应用实现了多层保障机制确保修改生效：

1. **重试机制**（最多 3 次尝试）
2. **NVRAM 同步**：
   - Linux: 调用 `sync` 命令 + 刷新文件系统缓存
   - 通过 `/sys/firmware/efi/efivars/` 触发内核同步
   - 额外的 `efibootmgr -v` 读取操作强制刷新
3. **验证机制**：设置后立即读取 BootOrder 验证是否写入成功
4. **延迟等待**：在关键操作间插入适当延迟确保硬件完成写入

**技术细节**：
```rust
// 核心同步流程
1. 执行 efibootmgr -o 设置启动顺序
2. 等待 100ms 让硬件完成初始写入
3. 执行 sync 命令刷新文件系统缓存
4. 写入 /proc/sys/vm/drop_caches 清理页缓存
5. 再次读取 efibootmgr 输出强制内核刷新
6. 验证当前 BootOrder 与期望值一致
7. 不一致则重试（间隔递增：200ms -> 400ms）
```

## 注意事项

⚠️ **重要安全提示**

- 修改 UEFI 启动项可能导致系统无法启动
- 建议在操作前先备份当前配置
- 如果系统无法启动，可以通过 BIOS/UEFI 设置界面恢复
- 应用会自动尝试最多 3 次写入操作，确保 NVRAM 真正被更新
- 如果看到 "NVRAM sync failed after multiple attempts" 错误，请重启到 BIOS 界面手动保存一次设置

## 故障排除

### 启动顺序修改后重启不生效

1. 确保以管理员/root权限运行应用
2. 尝试完全关机后冷启动（而不是重启）
3. 某些主板需要在 BIOS 中禁用 "Fast Boot" 选项
4. 检查是否有主板固件更新可用

### Linux 下权限问题

```bash
# 使用 sudo 运行（推荐）
sudo ./uefi-boot-manager

# 或者设置 efi 变量可写（不推荐）
sudo chmod o+w /sys/firmware/efi/efivars/BootOrder-*
```

## 许可证

MIT
