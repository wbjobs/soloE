# 终端系统监控器

一个基于 Textual 库构建的、美观的终端系统监控工具，类似 htop 但更加现代化。

## 功能特性

- **CPU 监控**：按核心显示实时使用率，并展示过去 30 秒的平均趋势
- **内存监控**：显示内存使用百分比和具体数值（GB），并展示历史趋势
- **网络监控**：显示上传/下载速率，并分别展示收发历史趋势
- **ASCII 折线图**：使用 Unicode 方块字符绘制美观的实时趋势图
- **分块布局**：清晰的界面分区，信息一目了然
- **配色方案**：根据使用率自动变色（绿色-黄色-红色）

## 安装依赖

```bash
pip install -r requirements.txt
```

或手动安装：

```bash
pip install textual psutil
```

## 运行方式

```bash
python system_monitor.py
```

## 项目结构

```
.
├── system_monitor.py    # 主程序，包含 UI 渲染和逻辑
├── monitor_data.py      # 数据获取模块，封装 psutil 功能
├── requirements.txt     # 依赖列表
└── README.md           # 说明文档
```

## 模块说明

### monitor_data.py
- `SystemMonitorData` 类：负责所有系统数据的获取和历史记录管理
- 支持获取 CPU、内存、网络数据
- 自动维护 30 秒历史记录用于绘制趋势图
- 与界面层完全分离，可独立测试和使用

### system_monitor.py
- `ASCIILineChart` 类：ASCII 折线图生成器
- `CPUWidget`：CPU 监控组件，显示各核心使用率和趋势图
- `MemoryWidget`：内存监控组件
- `NetworkWidget`：网络监控组件
- `SystemMonitorApp`：主应用程序，负责整体布局和定时更新

## 技术栈

- **Textual**：现代化的终端 UI 框架
- **Rich**：强大的终端文本渲染库
- **psutil**：跨平台系统监控库

## 退出方式

按 `Ctrl+C` 退出程序。
