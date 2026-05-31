# LDPC 磁盘镜像保护系统 v3.0

一个基于 LDPC（低密度奇偶校验）码的磁盘镜像完整性保护和数据恢复系统，支持交织保护对抗连续损坏，以及多节点分布式重建。

## ✨ 新特性 (v3.0)

- **分布式重建**：多客户端上传损坏镜像片段，后端联合解码恢复完整镜像
- **RAID 式联合解码**：结合多节点片段 + LDPC 校验，实现类似 RAID 的数据重建
- **Web 仪表板**：实时监控重建进度、节点贡献排行、块状态热力图
- **节点贡献统计**：记录各节点贡献的有效块数和唯一块数
- **批量片段上传**：支持批量上传，提高大镜像重建效率
- **热力图可视化**：ASCII 和 Web 双版本的块收集状态热力图

## 功能特性

- **分块保护**：将磁盘镜像分成 4KB 块，为每个块生成 LDPC 校验数据
- **20% 冗余**：使用 20% 的冗余度生成校验块
- **数据恢复**：支持最多 15% 块损坏的恢复
- **交织保护**：支持交织模式，可抵抗连续 1MB（256块）以上的连续损坏
- **损坏检测**：自动检测镜像中的损坏块
- **可视化报告**：生成损坏映射图和恢复成功率报告
- **异步处理**：大镜像支持异步上传，避免API超时
- **分布式重建**：多节点协作，联合解码恢复完整镜像
- **Web 仪表板**：实时监控重建进度和节点贡献
- **REST API**：FastAPI 后端提供完整的 API 接口

## 项目结构

```
e90/
├── backend/                 # 后端服务
│   ├── main.py             # FastAPI 主应用（含仪表板路由）
│   ├── database.py         # 数据库模型（含重建任务和片段表）
│   ├── schemas.py          # Pydantic 数据模型
│   ├── task_manager.py     # 轻量级异步任务管理器
│   ├── joint_decoder.py    # 多片段联合解码器（新增）
│   └── requirements.txt    # 后端依赖
├── cli/                     # CLI 工具
│   ├── main.py             # CLI 主入口（含 rebuild 命令组）
│   ├── api_client.py       # API 客户端（含重建功能）
│   ├── block_processor.py  # 块处理器
│   ├── ldpc.py             # LDPC 编解码器
│   ├── interleaver.py      # 块交织器
│   ├── recovery.py         # 恢复处理器
│   ├── report.py           # 报告生成器
│   └── requirements.txt    # CLI 依赖
├── dashboard/               # Web 仪表板（新增）
│   └── index.html          # 单页应用，实时监控重建状态
├── tests/                   # 测试脚本
│   ├── test_workflow.py    # 端到端测试
│   └── create_test_image.py # 创建测试镜像
├── start_backend.bat/sh    # 后端启动脚本
└── ldpc-cli.bat/sh         # CLI 快捷入口
```

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 启动后端服务

Windows:
```cmd
start_backend.bat
```

Linux/Mac:
```bash
chmod +x start_backend.sh
./start_backend.sh
```

或者手动启动:
```bash
cd backend
uvicorn main:app --reload --port 8000
```

后端服务将在 `http://localhost:8000` 启动。

- API 文档: http://localhost:8000/docs
- Web 仪表板: http://localhost:8000/dashboard/

### 3. 使用 CLI 工具

Windows:
```cmd
ldpc-cli.bat --help
```

Linux/Mac:
```bash
chmod +x ldpc-cli.sh
./ldpc-cli.sh --help
```

或者直接使用 Python:
```bash
python cli/main.py --help
```

## 使用示例

### 保护镜像（交织模式，推荐）

```bash
python cli/main.py protect /path/to/disk.img --name my_disk_image --interleave
```

### 验证镜像完整性

```bash
python cli/main.py verify /path/to/disk.img --name my_disk_image
```

### 恢复损坏的镜像

```bash
python cli/main.py recover /path/to/corrupted.img --name my_disk_image --output /path/to/recovered.img
```

## 🔄 分布式重建（多节点协作）

### 工作流程

```
节点A (损坏镜像) ──┐
                    ├─> 后端收集片段 ──> 联合解码 ──> 重建完整镜像
节点B (损坏镜像) ──┤
                    │
节点C (损坏镜像) ──┘
```

### 步骤1：创建重建任务

```bash
# 在任一节点上创建重建任务
python cli/main.py rebuild create --image-name my_disk_image --name "重建任务1"
```

### 步骤2：各节点上传片段

在每个拥有损坏镜像的节点上运行：

```bash
# 节点1上传它的损坏镜像片段
python cli/main.py rebuild upload-fragments --task-id <task_id> --image /path/to/corrupted1.img --node-name "节点1"

# 节点2上传它的损坏镜像片段
python cli/main.py rebuild upload-fragments --task-id <task_id> --image /path/to/corrupted2.img --node-name "节点2"

# 节点3上传它的损坏镜像片段
python cli/main.py rebuild upload-fragments --task-id <task_id> --image /path/to/corrupted3.img --node-name "节点3"
```

### 步骤3：查看收集状态

```bash
# 查看任务状态
python cli/main.py rebuild status <task_id>

# 查看块热力图
python cli/main.py rebuild heatmap <task_id>

# 查看节点贡献排行
python cli/main.py rebuild nodes <task_id>
```

### 步骤4：开始联合解码重建

```bash
python cli/main.py rebuild start <task_id>
```

### 步骤5：下载重建结果

```bash
python cli/main.py rebuild download <task_id> --output /path/to/rebuilt.img
```

### 其他重建命令

```bash
# 列出所有重建任务
python cli/main.py rebuild list

# 按状态过滤
python cli/main.py rebuild list --status collecting
```

## 📊 Web 仪表板

启动后端服务后，访问：http://localhost:8000/dashboard/

仪表板功能：
- **实时进度监控**：块收集进度和状态
- **节点贡献排行**：显示各节点贡献的块数
- **块状态热力图**：可视化显示每个块的收集状态
- **恢复方法分布**：饼图显示各恢复方法的使用情况
- **自动刷新**：支持5秒自动刷新

### 仪表板截图预览

```
┌─────────────────────────────────────────────────────────────┐
│ LDPC 分布式重建仪表板                                       │
├─────────────────────────────────────────────────────────────┤
│ 选择任务: [重建任务1 ▼]  [🔄刷新] [⏸️自动刷新]            │
├────────────┬────────────┬────────────┬──────────────────────┤
│  总块数    │  已收集    │  已恢复    │  不可恢复            │
│  12800     │  10240     │  8960      │  0                   │
├────────────┴────────────┴────────────┴──────────────────────┤
│ 收集进度: ████████████████████████░░░░ 80% (10240/12800)   │
│ 状态: collecting                                            │
├─────────────────────────────────────────┬───────────────────┤
│ 📊 块状态热力图                         │ 👥 节点贡献排行    │
│                                         │                   │
│ ■■■□□□■■□□... (12800 blocks)           │ 🥇 节点1: 4500块  │
│                                         │ 🥈 节点2: 3200块  │
│ 已恢复: 8960 | 已收集: 10240 | ...     │ 🥉 节点3: 2540块  │
├─────────────────────────────────────────┼───────────────────┤
│ 📈 恢复方法分布                         │ 🥧 节点贡献分布    │
│ [饼图] 直接恢复: 70%                    │ [饼图]             │
│        组合恢复: 20%                    │                   │
│        LDPC恢复: 10%                    │                   │
└─────────────────────────────────────────┴───────────────────┘
```

## 联合解码算法

三种恢复策略（按优先级）：

1. **直接恢复**：某个节点提供了完整正确的块 → 直接使用
2. **组合恢复**：从多个节点的部分正确片段中，逐字节投票组合
3. **LDPC 恢复**：使用存储的 LDPC 校验数据进行纠错恢复

## API 接口（重建相关）

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/rebuild/create` | 创建重建任务 |
| POST | `/api/rebuild/fragment/upload` | 上传单个片段 |
| POST | `/api/rebuild/fragment/batch` | 批量上传片段 |
| GET | `/api/rebuild/{task_id}` | 获取任务状态 |
| GET | `/api/rebuild` | 列出所有任务 |
| POST | `/api/rebuild/start` | 开始联合解码 |
| GET | `/api/rebuild/{task_id}/download` | 下载重建结果 |
| GET | `/api/rebuild/{task_id}/nodes` | 获取节点贡献 |
| GET | `/api/rebuild/{task_id}/heatmap` | 获取热力图数据 |

## 性能指标

**分布式重建恢复率**（3个节点，各有不同区域损坏）：

| 平均单节点损坏率 | 恢复率 |
|-----------------|--------|
| 10% | >99% |
| 20% | >95% |
| 30% | >80% |
| 40% | >50% |

## 完整工作流示例（分布式重建）

```bash
# 1. 首先保护原始镜像
python cli/main.py protect original.img --name my_image --interleave

# 2. 模拟3个节点各有不同区域的损坏
python cli/main.py simulate original.img node1_corrupted.img --continuous --continuous-length 300 --rate 0
python cli/main.py simulate original.img node2_corrupted.img --continuous --continuous-length 300 --rate 0
python cli/main.py simulate original.img node3_corrupted.img --continuous --continuous-length 300 --rate 0

# 3. 创建重建任务
python cli/main.py rebuild create --image-name my_image --name "分布式重建测试"

# 4. 各节点上传片段（实际应用中在不同机器上运行）
python cli/main.py rebuild upload-fragments --task-id <task_id> --image node1_corrupted.img --node-name "节点1"
python cli/main.py rebuild upload-fragments --task-id <task_id> --image node2_corrupted.img --node-name "节点2"
python cli/main.py rebuild upload-fragments --task-id <task_id> --image node3_corrupted.img --node-name "节点3"

# 5. 查看收集状态和热力图
python cli/main.py rebuild status <task_id>
python cli/main.py rebuild heatmap <task_id>

# 6. 打开 Web 仪表板监控
# 浏览器访问: http://localhost:8000/dashboard/

# 7. 开始联合解码
python cli/main.py rebuild start <task_id>

# 8. 下载重建结果
python cli/main.py rebuild download <task_id> --output rebuilt.img

# 9. 验证重建结果
python cli/main.py verify rebuilt.img --name my_image
```

## 运行测试

```bash
# 运行所有测试
python tests/test_workflow.py
```

## 注意事项

1. **分布式重建场景**：适合多个节点各持有部分损坏镜像的场景，如多副本损坏、RAID 阵列部分失效等。

2. **节点数量**：建议至少 2-3 个节点参与重建，节点越多恢复率越高。

3. **上传顺序**：节点可以任意顺序上传片段，后端会自动去重和合并。

4. **仪表板**：Web 仪表板需要后端服务运行，通过 `/dashboard/` 路径访问。

5. **联合解码开销**：联合解码是计算密集型操作，大镜像建议在高性能服务器上执行。

6. **存储空间**：重建过程中会临时存储所有片段，建议确保有足够的磁盘空间。

## License

MIT License
