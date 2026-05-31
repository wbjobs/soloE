# Gene Alignment Service - Bug Fixes

## 修复的问题

### 1. GPU显存管理问题

**问题描述**:
- 大序列比对时显存溢出
- 批量处理时显存分配未优化
- 缺少显存使用监控和安全检查

**解决方案**:
创建了 `GPUMemoryManager` 类，提供以下功能：

#### 核心功能
- **显存信息查询**: 获取GPU总显存、可用显存和利用率
- **智能显存分配**: 自动检查分配请求是否在安全范围内
- **安全系数保护**: 默认使用85%作为安全系数，防止显存耗尽
- **批次大小计算**: 根据序列长度自动计算最优批次大小

#### 使用示例
```cpp
#include "gpu_memory_manager.h"

using namespace gene::gpu;

// 获取显存信息
auto& mm = GPUMemoryManager::get_instance();
auto info = mm.get_memory_info();
std::cout << "Free: " << info.free_bytes << " bytes\n";

// 检查是否可以分配
if (mm.can_allocate(required_memory)) {
    // 安全分配
}

// 计算矩阵大小
size_t matrix_size = mm.calculate_matrix_size(seq1_len, seq2_len);

// 获取最优批次大小
size_t optimal_batch = mm.get_optimal_batch_size(max_seq_len);
```

#### 批次调度器
```cpp
GPUBatchScheduler scheduler;
auto batches = scheduler.schedule_batches(queries, targets);
```

---

### 2. 任务队列阻塞问题

**问题描述**:
- 批量任务处理时队列阻塞
- 长时间运行的任务导致后续任务超时
- 缺少超时处理机制

**解决方案**:
创建了 `TaskQueue` 类，提供以下功能：

#### 核心功能
- **多线程工作池**: 可配置的工作线程池
- **任务超时检测**: 自动检测并标记超时任务
- **非阻塞设计**: 使用条件变量实现高效的任务调度
- **任务状态跟踪**: PENDING/RUNNING/COMPLETED/TIMEOUT/FAILED/CANCELLED

#### 使用示例
```cpp
#include "task_queue.h"

using namespace gene;

// 创建任务队列（2个工作线程）
TaskQueue queue(2);

// 提交任务
std::string task_id = queue.submit_task(query, target, config, 
                                        std::chrono::milliseconds(30000));

// 查询状态
TaskStatus status = queue.get_task_status(task_id);

// 等待完成
queue.wait_for_task(task_id);

// 获取结果
auto result = queue.get_task_result(task_id);
```

#### 结果缓存
```cpp
auto& cache = ResultCache::get_instance();
std::string key = cache.generate_key(query_id, target_id, config);
cache.put(key, result);
auto cached = cache.get(key);
```

---

### 3. 可视化坐标错位问题

**问题描述**:
- 比对结果热图坐标显示错位
- 坐标范围超出序列实际长度
- 比对路径追踪不准确

**解决方案**:
创建了 `HeatmapVisualizer` 和 `AlignmentPathValidator` 类：

#### 核心功能
- **坐标验证**: 自动验证比对坐标的有效性
- **坐标自动修复**: 检测并修正无效坐标
- **准确路径追踪**: 从得分矩阵准确追踪比对路径
- **诊断信息输出**: 提供详细的坐标诊断信息

#### 使用示例
```cpp
#include "visualization.h"

using namespace gene::viz;

// 验证坐标
bool valid = AlignmentPathValidator::validate_coordinates(result, query, target);

// 自动修复
AlignmentPathValidator::fix_coordinates(result, query, target);

// 获取诊断信息
std::string diag = AlignmentPathValidator::get_diagnostic_info(result, query, target);

// 生成热图
HeatmapVisualizer::Config config;
config.cell_size = 8;
config.margin = 40;
config.show_alignment_path = true;

HeatmapVisualizer viz(config);
viz.generate_svg_heatmap(result, query, target, "output.svg");
```

---

## 项目结构

```
e70/
├── include/
│   ├── common.h              # 通用数据结构
│   ├── fasta_parser.h        # FASTA/FASTQ解析
│   ├── gpu_memory_manager.h  # GPU显存管理（新增）
│   ├── task_queue.h          # 任务队列（新增）
│   └── visualization.h       # 可视化（新增）
├── src/
│   ├── fasta_parser.cpp
│   ├── gpu_memory_manager.cpp
│   ├── task_queue.cpp
│   └── visualization.cpp
├── test/
│   └── test_fixes.cpp
└── CMakeLists.txt
```

---

## 编译和测试

### 编译
```bash
mkdir build
cd build
cmake ..
make
```

### 运行测试
```bash
./bin/test_fixes
```

测试内容：
1. GPU显存管理测试
2. 任务队列功能测试
3. 可视化坐标验证和修复测试
4. 结果缓存功能测试

---

## 关键改进点

### 1. 显存安全机制
- ✅ 安全系数保护（85%阈值）
- ✅ 自动批次大小计算
- ✅ 显存使用实时监控
- ✅ 智能任务分批次

### 2. 任务处理优化
- ✅ 非阻塞队列设计
- ✅ 超时自动检测
- ✅ 任务取消支持
- ✅ 结果缓存机制

### 3. 可视化准确性
- ✅ 坐标边界检查
- ✅ 自动坐标修复
- ✅ 精确路径追踪
- ✅ 诊断信息输出

---

## 使用建议

### 对于大序列比对
1. 首先使用 `GPUMemoryManager` 检查可用显存
2. 使用 `get_optimal_batch_size` 计算安全批次大小
3. 启用 `store_matrix = false` 减少内存使用

### 对于批量处理
1. 使用 `TaskQueue` 进行异步处理
2. 设置合理的超时时间（默认30秒）
3. 启用 `ResultCache` 避免重复计算

### 对于可视化
1. 在生成热图前调用 `AlignmentPathValidator::fix_coordinates`
2. 使用SVG格式获得更好的显示效果
3. 调整 `cell_size` 控制热图精度

---

## 未来改进方向

1. 支持多GPU支持
2. 动态工作池自动伸缩
3. 渐进式热图渲染
4. 实时进度回调支持
5. 更详细的性能监控指标
