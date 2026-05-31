# 演讲者模式功能说明

## 功能概述

演讲者模式是一个智能音视频会议功能，当某个参会者持续说话且音量最大时，系统会自动识别其为演讲者，并将其视频流以高质量分发给所有其他参会者，忽略网络质量限制。同时在UI上高亮显示演讲者。

## 核心功能

### 1. 语音活动检测 (VAD)
- 实时音频音量分析（每200ms采样一次）
- 使用Web Audio API的AnalyserNode进行频率分析
- 归一化音量值 (0-1)

### 2. 演讲者检测算法
- **说话时间阈值**：连续说话超过10秒才被识别为演讲者
- **音量优势检测**：音量需要比其他人大30%以上
- **沉默超时**：3秒无声音自动清除演讲者状态
- **平滑处理**：使用最近10个音量采样的平均值进行判断

### 3. 强制高质量传输
- 检测到演讲者后，SFU服务器强制将演讲者视频流设置为最高质量（1.5Mbps）
- 所有订阅者接收演讲者的高质量视频流，即使其网络状况不佳
- 演讲者空间层级: 2，时间层级: 2

### 4. 前端UI高亮
- 演讲者视频窗口金色边框和发光效果
- 右上角"🎤 演讲者"标签（带呼吸动画）
- 侧边栏显示演讲者模式状态卡片

## 技术实现

### 服务端 (server/)

#### SpeakerDetector.js (`src/audio/SpeakerDetector.js`)
- 管理房间内所有参与者的音量历史
- 实现演讲者检测算法
- 触发演讲者变更事件

```javascript
// 核心配置
MIN_SPEAKING_TIME = 10000       // 10秒
VOLUME_DOMINANCE_RATIO = 1.3    // 30%音量优势
SILENCE_TIMEOUT = 3000           // 3秒沉默超时
```

#### MediasoupManager.js 增强
- `setSpeakerPriority()` - 设置演讲者优先级
- `forceSpeakerHighQuality()` - 强制高质量转发
- `restoreAdaptiveQuality()` - 恢复自适应码率

#### index.js 集成
- Socket.io事件 `audioVolume` 接收客户端音量数据
- 并发控制防止重复切换
- 断开连接时清理资源

### 客户端 (client/)

#### WebRtcClient.ts 增强
- `startVolumeMonitoring()` - 使用Web Audio API监控本地音频
- `stopVolumeMonitoring()` - 清理音频资源
- `setOnSpeakerChanged()` - 演讲者变更回调

#### VideoPlayer.tsx 增强
- 新增 `isSpeaker` 属性
- 金色发光边框效果
- 演讲者标签动画

#### ConferenceRoom.tsx 增强
- 演讲者状态管理
- 侧边栏演讲者信息卡片
- 传递演讲者状态给视频组件

## 检测流程

```
客户端采集音频
    ↓
Web Audio API分析音量
    ↓
发送audioVolume事件到服务端 (每200ms)
    ↓
SpeakerDetector更新音量历史
    ↓
检测:
  ✓ 连续说话 > 10秒?
  ✓ 音量比其他人高30%?
    ↓
    是 → 触发演讲者模式
        ↓
        SFU强制高质量转发
        前端UI高亮显示
    ↓
    否 → 继续检测
```

## 配置参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 最小说话时间 | 10秒 | 触发演讲者模式所需持续时间 |
| 音量优势比率 | 1.3 (30%) | 演讲者需要比其他人大多少 |
| 沉默超时 | 3秒 | 无声音多久后清除演讲者 |
| 音量采样间隔 | 200ms | 客户端采集频率 |
| 平滑采样数 | 10个 | 计算平均音量的历史样本数 |

## 使用说明

### 启动服务
```bash
cd server
npm install
npm start
```

### 启动客户端
```bash
cd client
npm install
npm run dev
```

### 测试演讲者模式
1. 2人以上加入同一会议室
2. 其中一人持续说话10秒以上
3. 保持说话音量比其他人大（可以让其他人保持静音）
4. 10秒后自动触发演讲者模式
5. 说话者的视频窗口会显示金色高亮和"🎤 演讲者"标签
6. 停止说话3秒后自动恢复正常模式

## 日志说明

```
[SpeakerDetector] New speaker detected in room conference-1: 张三
[SpeakerDetector] Volume: 0.85, Duration: 10200ms
[SpeakerPriority] Speaker xyz set as priority in room conference-1
[SpeakerPriority] Forced high quality for speaker xyz to all subscribers
[LayerSwitch] Consumer abc: 0/0 -> 2/2 (downgrade: false)
```

## 性能优化

1. **音频采样优化**：使用200ms间隔而非实时，减少性能开销
2. **并发控制**：切换过程中忽略新的切换请求
3. **历史数据清理**：只保留最近50个音量样本
4. **平滑过渡**：使用最近10个样本的平均值减少突变

## 后续改进方向

- [ ] 支持手动设置/取消演讲者
- [ ] 演讲者优先级队列
- [ ] 语音活动检测的噪声抑制
- [ ] 多语言演讲者名称显示
- [ ] 演讲时长统计和报告
