# 会议录音分析工具

一个基于 AI 的会议录音自动分析工具，支持语音转录、多发言人识别、智能内容分析和 XMind 脑图生成。

## 功能特性

### 核心功能
- 🎤 **语音转录**: 使用 Faster-Whisper (medium 模型) + int8 量化，速度提升 2-4 倍
- ⚡ **VAD 语音活动检测**: 自动过滤静音片段，提高转录准确性
- 👥 **多发言人识别**: 基于 MFCC 特征 + 层次聚类，可选 Pyannote 预训练模型
- 🤖 **智能分析**: 调用本地 Ollama (command-r 模型) 提取会议决策、待办事项和争议点
  - 严格 JSON Schema 输出格式
  - 多层级正则 fallback 机制，确保提取成功率
- 🧠 **XMind 脑图**: 自动生成结构化的会议脑图，兼容 XMind 2020+ 格式
- 🔍 **历史搜索**: 支持会议标题、内容的全文搜索
- 💾 **本地存储**: 所有数据本地存储，隐私安全

### 新增功能
- 🎙️ **实时转写模式**: WebSocket 流式音频，边录边转
- ✉️ **会议总结邮件**: 一键生成会议纪要邮件草稿，支持多种模板
- 🧠 **脑图在线编辑器**: 可拖拽节点编辑，支持导出 Markdown/JSON

## 环境要求

### 必需软件
1. **Python 3.9+**: https://www.python.org/downloads/
2. **FFmpeg**: 用于音频处理
   - Windows: 下载 FFmpeg 并添加到 PATH
   - 下载地址: https://ffmpeg.org/download.html
3. **Ollama**: 用于本地 LLM 推理
   - 下载地址: https://ollama.com/
   - 安装后拉取 command-r 模型: `ollama pull command-r`

### 硬件建议
- **GPU**: 推荐 NVIDIA GPU (CUDA)，可以大幅提升 Whisper 转录速度
- **内存**: 至少 8GB RAM，推荐 16GB+
- **磁盘**: Whisper medium 模型约 1.5GB，command-r 模型约 20GB

## 快速开始

### 1. 安装 Ollama 并下载模型
```bash
# 安装 Ollama 后，在命令行执行
ollama pull command-r
```

### 2. 启动服务

**Windows 用户**: 直接双击 `start.bat`

**或手动执行**:
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

### 3. 访问应用
打开浏览器访问: http://localhost:8000

## 使用说明

### 上传会议录音
1. 点击或拖拽 .m4a 格式的录音文件到上传区域
2. (可选) 填写会议标题
3. (可选) 指定发言人数，不填则自动检测
4. 点击"开始分析"
5. 等待处理完成（处理时间取决于录音长度）

### 查看分析结果
- 点击左侧历史会议列表中的会议查看详情
- 查看会议摘要、决策、待办事项、争议点
- 下载 XMind 格式的脑图文件

### 搜索会议
- 在搜索框输入关键词
- 支持搜索标题、转录内容和摘要

## 配置说明

可以在 `backend/.env` 文件中配置以下参数（复制 `.env.example` 为 `.env`）：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `WHISPER_MODEL` | `medium` | Whisper 模型大小: tiny/base/small/medium/large |
| `WHISPER_COMPUTE_TYPE` | `int8` | 计算精度: int8/float16/float32 |
| `WHISPER_DEVICE` | `auto` | 运行设备: auto/cuda/cpu |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama 服务地址 |
| `OLLAMA_MODEL` | `command-r` | Ollama 模型名称 |
| `MAX_SPEAKERS` | `10` | 最大发言人数量 |
| `DEFAULT_SPEAKERS` | `2` | 默认发言人数量 |
| `USE_PYANNOTE` | `false` | 是否使用 Pyannote 模型 |
| `PYANNOTE_AUTH_TOKEN` | `""` | Hugging Face API Token |
| `VAD_MIN_SPEECH_DURATION` | `0.3` | 最小语音片段时长(秒) |
| `VAD_MAX_SPEECH_DURATION` | `30.0` | 最大语音片段时长(秒) |

## 技术架构

### 后端模块
- **[audio_processor.py](backend/audio_processor.py)**: 音频处理模块
  - Faster-Whisper 转录（int8 量化）
  - VAD 语音活动检测（能量-based + Pyannote 可选）
  - 说话人聚类（MFCC 特征 + 层次聚类 + Pyannote 嵌入可选）
  - 发言人标签平滑

- **[llm_analyzer.py](backend/llm_analyzer.py)**: LLM 分析模块
  - JSON Schema 约束输出
  - 多层级 JSON 提取（代码块/正则/逐行）
  - 3 次重试机制
  - 正则 fallback 提取（决策/待办/争议点/摘要）
  - 结果验证与修复

- **[xmind_generator.py](backend/xmind_generator.py)**: XMind 生成模块
  - XMind 2020+ 格式（ZIP + JSON）
  - 支持标记、样式、备注
  - 可选 Markdown 格式导出

- **[main.py](backend/main.py)**: FastAPI 主应用
  - RESTful API 接口
  - 异步任务处理
  - SQLite 数据库存储

## 项目结构

```
e97/
├── backend/                 # 后端代码
│   ├── main.py             # FastAPI 主应用
│   ├── config.py           # 配置文件
│   ├── database.py         # 数据库模型
│   ├── schemas.py          # 数据结构定义
│   ├── audio_processor.py  # 音频处理 (Whisper + 声纹聚类)
│   ├── llm_analyzer.py     # LLM 分析模块
│   ├── xmind_generator.py  # XMind 生成模块
│   ├── requirements.txt    # Python 依赖
│   └── .env.example        # 环境变量示例
├── frontend/               # 前端代码
│   ├── index.html          # 主页面
│   ├── styles.css          # 样式文件
│   └── app.js              # 前端逻辑
├── start.bat               # Windows 启动脚本
└── README.md               # 本文件
```

## API 接口

### 会议管理
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/meetings/upload` | 上传会议录音 |
| GET | `/api/meetings` | 获取会议列表 |
| GET | `/api/meetings/search?q=xxx` | 搜索会议 |
| GET | `/api/meetings/{id}` | 获取会议详情 |
| PUT | `/api/meetings/{id}` | 更新会议信息 |
| DELETE | `/api/meetings/{id}` | 删除会议 |
| GET | `/api/meetings/{id}/xmind` | 下载 XMind 文件 |

### 实时转写
| 方法 | 路径 | 说明 |
|------|------|------|
| WS | `/ws/realtime/{session_id}` | WebSocket 实时转写连接 |
| POST | `/api/realtime/save` | 保存实时转写结果 |

### 邮件生成
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/email/templates` | 获取可用邮件模板 |
| GET | `/api/meetings/{id}/email` | 生成会议邮件草稿 |
| POST | `/api/email/generate` | 生成邮件（POST 方式） |

### 其他
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |

## 常见问题

### Q: Whisper 模型下载慢怎么办？
A: 可以设置环境变量 `HF_ENDPOINT=https://hf-mirror.com` 使用国内镜像。

### Q: 可以使用其他 Whisper 模型吗？
A: 可以，修改 `.env` 文件中的 `WHISPER_MODEL`，支持 `tiny`, `base`, `small`, `medium`, `large`。

### Q: 可以使用其他 LLM 模型吗？
A: 可以，修改 `.env` 文件中的 `OLLAMA_MODEL`，只要 Ollama 支持的模型都可以。

### Q: XMind 文件用什么打开？
A: 使用 XMind 8 或 XMind Zen 打开，也可以导入到 MindManager 等其他脑图软件。

## 注意事项

1. 首次运行会自动下载 Whisper 模型，请保持网络连接
2. 长音频处理时间较长，请耐心等待
3. 建议使用 GPU 加速以提高处理速度
4. 确保有足够的磁盘空间存储模型和上传的文件

## 许可证

MIT License
