# 数据迁移校验工具

一个功能完整的 MySQL 到 PostgreSQL 数据迁移校验工具，支持 CLI 和 Web 监控面板。

## 功能特性

- 🚀 **自动表结构迁移**: 自动从 MySQL 读取表结构并转换为 PostgreSQL DDL
- 🔄 **全量数据迁移**: 批量数据迁移，支持断点续传
- ✅ **数据完整性校验**: 逐行对比 MD5，确保数据一致性
- ⚡ **并发控制**: 多表并发迁移，提高迁移效率
- 🎯 **限速控制**: 可配置每秒处理行数，避免源库压力过大
- 📊 **实时监控面板**: Express + React 构建的 Web 面板，实时显示迁移进度
- 💾 **断点续传**: 支持中断后从上次位置继续迁移

## 项目结构

```
├── src/
│   ├── cli/              # CLI 命令行入口
│   ├── config/           # 配置示例
│   ├── db/               # 数据库连接模块
│   │   ├── mysql.ts      # MySQL 客户端
│   │   └── postgresql.ts # PostgreSQL 客户端
│   ├── migration/        # 迁移核心模块
│   │   ├── coordinator.ts # 迁移协调器
│   │   ├── migrator.ts   # 数据迁移器
│   │   ├── schema.ts     # DDL 转换
│   │   └── validator.ts  # 数据校验器
│   ├── server/           # Express 后端
│   └── types/            # 类型定义
├── web/                  # React 前端
│   └── src/
│       ├── components/   # React 组件
│       ├── App.tsx       # 主应用
│       └── socket.ts     # Socket.io 客户端
└── package.json
```

## 快速开始

### 1. 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd web && npm install && cd ..
```

### 2. 创建配置文件

```bash
npm run dev -- init -c config.json
```

编辑 `config.json` 填入你的数据库连接信息：

```json
{
  "source": {
    "host": "localhost",
    "port": 3306,
    "user": "root",
    "password": "your_mysql_password",
    "database": "source_database"
  },
  "target": {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "your_postgres_password",
    "database": "target_database"
  },
  "tables": [
    {
      "sourceTable": "users",
      "targetTable": "users",
      "primaryKey": "id",
      "batchSize": 1000
    }
  ],
  "concurrency": 2,
  "rateLimit": 1000,
  "checkpointPath": "./checkpoint.json",
  "validate": true
}
```

### 3. 运行迁移

#### 命令行模式

```bash
npm run dev -- migrate -c config.json
```

#### Web 监控模式

```bash
npm run dev -- migrate -c config.json --server
```

然后访问 http://localhost:3001 查看监控面板。

## 配置说明

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| source | Object | MySQL 连接配置 | - |
| target | Object | PostgreSQL 连接配置 | - |
| tables | Array | 要迁移的表配置列表 | - |
| tables[].sourceTable | String | 源表名 | - |
| tables[].targetTable | String | 目标表名 | - |
| tables[].primaryKey | String | 主键列名 | - |
| tables[].columns | Array | 指定列迁移（可选） | 所有列 |
| tables[].batchSize | Number | 每批处理行数 | 1000 |
| concurrency | Number | 并发迁移的表数量 | 1 |
| rateLimit | Number | 每秒处理行数限制 | 1000 |
| checkpointPath | String | 断点续传文件路径 | ./checkpoint.json |
| validate | Boolean | 迁移后是否校验数据 | true |

## CLI 命令

### init

创建示例配置文件：

```bash
migrate init [-o <output-path>]
```

### migrate

运行数据迁移：

```bash
migrate migrate -c <config-path> [--no-validate] [--server] [--port <port>]
```

选项：
- `-c, --config <path>`: 配置文件路径（必需）
- `--no-validate`: 跳过数据校验
- `--server`: 启动 Web 监控服务器
- `--port <port>`: Web 服务器端口（默认 3001）

## Web 监控面板

Web 面板提供以下功能：

- **总览统计**: 显示整体迁移进度、已迁移行数、已校验行数、失败行数
- **表级进度**: 每个表的迁移进度条、状态、速度、预计剩余时间
- **实时日志**: 实时显示迁移过程中的日志信息
- **状态指示**: 不同状态使用不同颜色标识（等待中、迁移中、校验中、已完成、失败）

## 数据类型映射

MySQL 类型自动转换为 PostgreSQL 对应类型：

| MySQL 类型 | PostgreSQL 类型 |
|-----------|----------------|
| TINYINT | SMALLINT |
| SMALLINT | SMALLINT |
| INT/INTEGER | INTEGER |
| BIGINT | BIGINT |
| FLOAT | REAL |
| DOUBLE | DOUBLE PRECISION |
| DECIMAL/NUMERIC | NUMERIC |
| VARCHAR | VARCHAR |
| CHAR | CHAR |
| TEXT/TINYTEXT/MEDIUMTEXT/LONGTEXT | TEXT |
| BLOB/BINARY/VARBINARY | BYTEA |
| ENUM/SET | TEXT |
| DATE | DATE |
| TIME | TIME WITHOUT TIME ZONE |
| DATETIME/TIMESTAMP | TIMESTAMP WITHOUT TIME ZONE |
| BOOL/BOOLEAN | BOOLEAN |
| JSON | JSONB |

## 断点续传

迁移过程中会定期将进度保存到 checkpoint 文件。如果迁移被中断，重新运行时会自动从上次中断的位置继续。

Checkpoint 文件包含每个表的：
- 最后处理的主键值
- 已迁移行数
- 失败行数
- 已校验行数
- 校验失败行数
- 当前状态

## 注意事项

1. 确保 PostgreSQL 数据库已存在，且用户有创建表和写入数据的权限
2. 大表迁移建议在业务低峰期进行
3. 建议先在测试环境验证迁移流程
4. 迁移前请务必备份源数据库
5. 如果使用 `--server` 模式，需要先构建前端 `cd web && npm run build`

## 开发

### 编译 TypeScript

```bash
npm run build
```

### 开发模式运行

```bash
# 仅后端
npm run dev -- migrate -c config.json

# 前后端同时运行（开发模式）
npm start
```

## License

MIT
