# WebRTC 音视频录制工具

基于 WebRTC 的实时音视频录制工具，支持实时字幕生成和书签功能。

## 功能特性

- 🎥 **音视频录制** - 使用 WebRTC 技术捕获摄像头和麦克风
- 🎤 **多麦克风选择** - 支持选择不同的音频输入设备
- 📊 **实时音量可视化** - 使用 Web Audio API 显示音量波形
- 🏷️ **书签功能** - 录制过程中标记重要时间点
- 📝 **实时字幕** - 自动生成语音识别字幕
- 🎬 **MP4 导出** - 录制完成后生成带字幕的 MP4 视频
- 📄 **SRT 字幕导出** - 独立字幕文件下载

## 技术栈

### 后端
- Node.js + TypeScript
- WebSocket (ws)
- Express
- FFmpeg (fluent-ffmpeg)
- Whisper (语音识别)

### 前端
- React 18 + TypeScript
- Tailwind CSS
- WebRTC / MediaRecorder API
- Web Audio API

## 项目结构

```
.
├── backend/                 # 后端服务
│   ├── src/
│   │   ├── server.ts       # 主服务器
│   │   ├── whisperService.ts  # 语音识别服务
│   │   ├── ffmpegService.ts   # 视频处理服务
│   │   └── types.ts        # 类型定义
│   ├── recordings/         # 录制文件存储
│   ├── uploads/            # 临时文件
│   └── package.json
└── frontend/               # 前端应用
    ├── src/
    │   ├── components/     # React 组件
    │   ├── hooks/          # 自定义 Hooks
    │   └── App.tsx         # 主应用
    └── package.json
```

## 安装和运行

### 前置要求

- Node.js 16+
- FFmpeg (需要安装并配置到 PATH)

### 后端安装

```bash
cd backend
npm install
npm run dev
```

后端服务将在 http://localhost:3001 运行

### 前端安装

```bash
cd frontend
npm install
npm start
```

前端应用将在 http://localhost:3000 运行

## 使用说明

1. **允许设备权限** - 首次使用时允许浏览器访问摄像头和麦克风
2. **选择音频设备** - 在右侧面板选择要使用的麦克风
3. **开始录制** - 点击"开始录制"按钮开始捕获音视频
4. **添加书签** - 在录制过程中输入书签名称并点击"添加"
5. **查看字幕** - 语音内容会自动识别并显示实时字幕
6. **停止录制** - 点击"停止录制"完成录制
7. **下载文件** - 录制完成后可下载 MP4 视频和 SRT 字幕文件

## WebSocket 消息协议

### 客户端 -> 服务端

| 类型 | 说明 | 数据 |
|------|------|------|
| start-recording | 开始录制 | {} |
| audio-chunk | 音频数据块 | { audio: base64 } |
| video-chunk | 视频数据块 | { video: base64 } |
| add-bookmark | 添加书签 | { time: number, label: string } |
| stop-recording | 停止录制 | {} |

### 服务端 -> 客户端

| 类型 | 说明 | 数据 |
|------|------|------|
| recording-started | 录制已开始 | { sessionId: string } |
| subtitles-update | 字幕更新 | { subtitles: Subtitle[] } |
| bookmark-added | 书签已添加 | { bookmarks: Bookmark[] } |
| recording-completed | 录制完成 | { videoUrl, subtitlesUrl, bookmarks, subtitles } |

## 注意事项

1. 需要 HTTPS 或 localhost 环境才能使用 WebRTC API
2. FFmpeg 必须正确安装并配置到系统 PATH
3. 录制文件会保存在 backend/recordings 目录
4. 浏览器必须支持 MediaRecorder API (Chrome, Firefox, Edge)
