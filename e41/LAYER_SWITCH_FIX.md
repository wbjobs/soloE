# 码率切换黑屏问题修复说明

## 问题现象
当订阅者网络质量变化（如 WiFi 切换到 4G，RTT 从 30ms 跳到 200ms）时，SFU 触发码率降级，但切换过程中所有订阅该流的客户端会出现 2-3 秒的黑屏。

## 根本原因分析
1. **直接层切换**：原代码直接调用 `setPreferredLayers` 跳转到目标层，没有等待关键帧
2. **缺少渐进过渡**：空间层和时间层同时切换，导致解码器无法正确解码新层
3. **缺少并发控制**：多次网络统计可能触发重复的切换请求
4. **切换过于频繁**：切换触发阈值不够严格，导致频繁切换

## 修复方案

### 1. MediasoupManager 增强 ([server/src/mediasoup/MediasoupManager.js](file:///e:/soloE/e41/server/src/mediasoup/MediasoupManager.js))

#### 新增方法：`setConsumerPreferredLayersSmooth()`
- **降级策略**：先降时间层，再逐级降空间层，每层间有延迟
  - 时间层切换延迟：100ms
  - 空间层每步切换延迟：150ms
- **升级策略**：先逐级升空间层，再升时间层
  - 空间层每步切换延迟：200ms
  - 时间层切换前额外延迟：100ms
- **提前返回**：目标层与当前层相同时直接返回

#### 新增方法：`requestProducerKeyFrame()`
- 升级时请求关键帧，确保解码器能正确解码新的更高质量层

#### 新增方法：`delay()`
- 异步延迟工具函数

### 2. BitrateAdaptation 优化 ([server/src/adaptation/BitrateAdaptation.js](file:///e:/soloE/e41/server/src/adaptation/BitrateAdaptation.js))

#### 状态跟踪增强
- `targetLayer`：目标层（切换过程中）
- `isTransitioning`：是否正在切换中
- `rttTrend`：RTT 趋势（increasing/decreasing/stable）
- `lastRtts`：最近 5 个 RTT 样本

#### 切换触发优化
- **升级最小间隔**：5000ms（原 3000ms）
- **降级最小间隔**：2000ms（原 3000ms）
- **升级所需连续次数**：4 次（原 3 次）
- **降级所需连续次数**：3 次（原 2 次）

#### 新增机制
- **紧急降级**：网络评分 ≤ 0.1 时立即降级到最低层
- **RTT 趋势检测**：RTT 持续上升 50% 以上时提前触发降级
- **切换确认机制**：`confirmLayerChange()` 方法在切换完成后更新当前层

### 3. 信令服务器集成 ([server/src/index.js](file:///e:/soloE/e41/server/src/index.js))

#### 并发控制
- `clientSwitchingStates` Map 跟踪每个客户端的切换状态
- 正在切换时忽略新的切换请求，避免冲突

#### 智能关键帧请求
- 升级前请求所有相关 producer 的关键帧
- 降级时不需要关键帧（低分辨率层可以直接从高分辨率层解码）

#### 并行处理
- 多个 consumer 并行切换，提高效率

## 切换流程对比

### 原流程（有问题）
```
网络变差 → 立即触发 setPreferredLayers(目标层) → 缺少关键帧 → 黑屏 2-3s
```

### 新流程（修复后）
```
网络变差 → 连续 3 次检测确认 → 标记正在切换 →
  ├─ 降级：先降时间层 → 100ms 延迟 → 逐级降空间层 → 150ms 每步
  └─ 升级：请求关键帧 → 50ms 延迟 → 逐级升空间层 → 200ms 每步 → 升时间层
→ 确认切换完成 → 更新当前层
```

## 预期效果
- ✅ 消除码率切换时的黑屏现象
- ✅ 切换过程画面平滑过渡（可能短暂画质下降，但不会黑屏）
- ✅ 减少不必要的频繁切换
- ✅ 网络急剧变差时快速响应（紧急降级）
- ✅ 详细的日志便于调试

## 日志标签
- `[LayerSwitch]`：层切换相关日志
- `[KeyFrame]`：关键帧请求相关日志
- `[BitrateAdaptation]`：码率自适应决策日志
