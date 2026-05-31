# 园区门禁系统 (Access Control System)

## 项目概述

基于 Spring Boot 的园区门禁管理系统，支持 NFC 卡绑定人员、时间段策略配置和节假日例外管理。

## 项目结构

```
e75/
├── pom.xml                          # 父POM (聚合项目)
├── access-control-backend/          # 后端API服务
│   ├── pom.xml
│   └── src/main/
│       ├── java/com/example/accesscontrol/
│       │   ├── AccessControlApplication.java    # 启动类
│       │   ├── controller/                      # REST API控制器
│       │   ├── service/                         # 业务逻辑层
│       │   ├── repository/                      # 数据访问层
│       │   ├── model/                           # 实体模型
│       │   ├── dto/                             # 数据传输对象
│       │   └── config/                          # 配置类
│       └── resources/
│           └── application.yml                  # 应用配置
└── access-control-cli/              # 命令行工具
    ├── pom.xml
    └── src/main/java/com/example/accesscontrol/cli/
        ├── AccessControlCli.java                # CLI主类
        └── AccessCheckResponse.java             # API响应模型
```

## 功能特性

### 后端 API
- **人员管理**: 新增、查询、更新、删除人员信息
- **NFC卡管理**: NFC卡与人员绑定，分配门禁策略
- **时间段策略**: 配置每周允许通行的时间段
- **节假日管理**: 配置节假日例外，支持全天禁止通行
- **门禁检查**: 根据卡号和时间判断是否允许通行

### 命令行工具
- `--check <uid> <datetime>`: 模拟刷卡，调用后端API判断是否允许通行
- `--help` / `-h`: 显示帮助信息

## 快速开始

### 环境要求
- JDK 17+
- Maven 3.8+

### 编译项目

```bash
# 在项目根目录执行
mvn clean package
```

### 启动后端服务

```bash
cd access-control-backend
mvn spring-boot:run
```

服务将在 `http://localhost:8080` 启动。

### H2 数据库控制台
访问 `http://localhost:8080/h2-console`
- JDBC URL: `jdbc:h2:mem:accessdb`
- 用户名: `admin`
- 密码: (留空)

## API 接口

### 门禁检查
- `GET /api/access/check?uid=<uid>&datetime=<datetime>`
- `POST /api/access/check`

### 人员管理
- `GET /api/persons` - 查询所有人员
- `GET /api/persons/{id}` - 查询指定人员
- `POST /api/persons` - 新增人员
- `PUT /api/persons/{id}` - 更新人员
- `DELETE /api/persons/{id}` - 删除人员

### NFC卡管理
- `GET /api/cards` - 查询所有卡片
- `GET /api/cards/{uid}` - 查询指定卡片
- `POST /api/cards` - 新增卡片
- `PUT /api/cards/{uid}` - 更新卡片
- `DELETE /api/cards/{uid}` - 删除卡片

### 时间段策略
- `GET /api/policies` - 查询所有策略
- `GET /api/policies/{id}` - 查询指定策略
- `POST /api/policies` - 新增策略
- `PUT /api/policies/{id}` - 更新策略
- `DELETE /api/policies/{id}` - 删除策略

### 节假日管理
- `GET /api/holidays` - 查询所有节假日
- `GET /api/holidays/date/{date}` - 查询指定日期节假日
- `POST /api/holidays` - 新增节假日
- `PUT /api/holidays/{id}` - 更新节假日
- `DELETE /api/holidays/{id}` - 删除节假日

## 命令行工具使用

### 编译后运行

```bash
cd access-control-cli
java -jar target/access-control-cli-1.0.0.jar --check NFC001 2026-05-18T10:00:00
```

### 直接运行（开发模式）

```bash
cd access-control-cli
mvn exec:java -Dexec.mainClass="com.example.accesscontrol.cli.AccessControlCli" -Dexec.args="--check NFC001 2026-05-18T10:00:00"
```

## 预置测试数据

系统启动时会自动创建以下测试数据：

### 人员
- 张三 (EMP001) - 技术部
- 李四 (EMP002) - 市场部

### NFC卡
- `NFC001` - 张三 - 标准工作日策略
- `NFC002` - 李四 - 全天通行策略

### 时间段策略
1. **标准工作日策略**: 周一至周五 09:00-17:00, 周六 10:00-14:00, 节假日禁止
2. **全天通行策略**: 所有时间段通行, 节假日不限制

### 节假日
- 元旦 (2026-01-01) - 禁止通行
- 春节 (2026-02-17) - 禁止通行
- 国庆节 (2026-10-01) - 禁止通行

## 测试示例

```bash
# 1. 工作时间通行 (周一上午10点) - 应该允许
java -jar access-control-cli.jar --check NFC001 2026-05-18T10:00:00

# 2. 非工作时间 (周一晚上8点) - 应该拒绝
java -jar access-control-cli.jar --check NFC001 2026-05-18T20:00:00

# 3. 周六中午 (周六在允许时间内) - 应该允许
java -jar access-control-cli.jar --check NFC001 2026-05-23T12:00:00

# 4. 节假日 (元旦) - 应该拒绝
java -jar access-control-cli.jar --check NFC001 2026-01-01T10:00:00

# 5. 李四全天通行 (周一深夜) - 应该允许
java -jar access-control-cli.jar --check NFC002 2026-05-18T23:00:00
```

## 门禁判断逻辑

1. 检查NFC卡是否存在
2. 检查NFC卡是否已激活
3. 检查NFC卡是否绑定人员
4. 检查是否配置门禁策略
5. 检查当天是否为节假日（如策略设置了节假日禁止，则拒绝）
6. 检查当前时间是否在策略允许的时间段内
