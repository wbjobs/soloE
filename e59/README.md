# 代码异味分析工具 (CodeSmell CLI)

一个基于 Python + Tree-sitter 的代码异味分析工具，支持分析 Python 和 JavaScript/TypeScript 代码。

## 功能特性

### 🔍 支持的代码异味检测

1. **过长函数** (Long Function) - 函数代码行数超过阈值（默认50行）
2. **过多参数** (Too Many Parameters) - 函数参数数量超过阈值（默认5个）
3. **深层嵌套** (Deep Nesting) - 控制流嵌套深度超过阈值（默认4层）
4. **上帝类** (God Class) - 类过于庞大，承担过多职责（默认方法>20或属性>15）
5. **重复代码** (Duplicate Code) - 代码块重复出现（默认≥6行，相似度≥85%）

### 📊 严重程度评分

- **LOW (低)** - 0-39分
- **MEDIUM (中)** - 40-59分
- **HIGH (高)** - 60-79分
- **CRITICAL (严重)** - 80-100分

### 🤖 AI 重构建议

集成 Ollama 本地大模型（默认使用 qwen2.5-coder:7b），为每个代码异味提供：
- 详细的重构建议
- 重构后的示例代码
- 改进收益说明

### 📋 输出格式

- **终端彩色报告** - 美观的控制台输出，支持代码高亮
- **JSON 格式** - 机器可读的完整分析结果

## 安装

### 1. 安装 Python 依赖

```bash
pip install -r requirements.txt
```

或使用 poetry：

```bash
poetry install
```

### 2. （可选）安装 Ollama 以启用 AI 功能

1. 从 [https://ollama.ai](https://ollama.ai) 下载并安装 Ollama
2. 启动 Ollama 服务：
   ```bash
   ollama serve
   ```
3. 拉取代码模型：
   ```bash
   ollama pull qwen2.5-coder:7b
   ```

检查 Ollama 状态：

```bash
python -m codesmell.cli check
```

## 使用方法

### 基本用法

分析单个文件：

```bash
python -m codesmell.cli analyze test_bad_code.py
```

分析整个目录：

```bash
python -m codesmell.cli analyze ./src
```

分析多个路径：

```bash
python -m codesmell.cli analyze file1.py file2.js ./src
```

### 启用 AI 重构建议

```bash
python -m codesmell.cli analyze test_bad_code.py --ai
```

### 输出 JSON 格式

```bash
python -m codesmell.cli analyze test_bad_code.py --json
```

保存到文件：

```bash
python -m codesmell.cli analyze test_bad_code.py -o report.json
```

### 自定义阈值

```bash
python -m codesmell.cli analyze test_bad_code.py \
    --max-function-lines 30 \
    --max-params 3 \
    --max-nesting 3
```

### 其他选项

```bash
# 不显示代码片段
python -m codesmell.cli analyze test_bad_code.py --no-show-code

# 不递归扫描目录
python -m codesmell.cli analyze ./src --no-recursive

# 查看帮助
python -m codesmell.cli analyze --help
```

## 项目结构

```
codesmell/
├── __init__.py          # 包初始化
├── models.py            # 数据模型（CodeSmell, AnalysisResult, AnalysisReport）
├── parser.py            # Tree-sitter 解析器封装
├── detectors.py         # 异味检测器实现
├── analyzer.py          # 核心分析器
├── ai_refactor.py       # Ollama AI 重构建议集成
├── formatter.py         # 输出格式化（JSON + 控制台彩色）
└── cli.py               # CLI 入口
```

## 支持的语言

- Python (.py)
- JavaScript (.js)
- JSX (.jsx)
- TypeScript (.ts)
- TSX (.tsx)

## 示例输出

### 终端彩色报告

```
======================================================================
   代码异味分析报告
======================================================================

分析文件数: 1
发现异味数: 5
整体严重度: HIGH (65.0)

异味类型统计:
  • 过长函数: 1
  • 过多参数: 1
  • 深层嵌套: 1
  • 上帝类: 1
  • 重复代码: 1

──────────────────────────────────────────────────────────────────────
📄 test_bad_code.py
   语言: Python | 行数: 138 | 异味: 5
──────────────────────────────────────────────────────────────────────

◓ [1] 上帝类
   严重度: HIGH (74/100)
   位置: 第 1-41 行
   描述: 类 'VeryLargeClass' 有 21 个方法和 16 个属性，可能是上帝类
...
```

## 许可证

MIT
