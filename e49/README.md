# symconflict - 跨平台动态库符号冲突分析工具

一个用Rust编写的命令行工具，用于分析和解决C/C++动态库(.so/.dylib/.dll)中的符号冲突问题。

## 功能特性

### 分析功能
- 🔍 **递归依赖解析**: 自动分析目标文件及其所有依赖的动态库
- 📊 **符号提取**: 提取每个库的导出符号表（全局符号、弱符号、版本化符号）
- ⚠️ **冲突检测**: 检测同名符号冲突，特别是全局变量和函数
- 💡 **智能建议**: 按优先级规则（加载顺序、符号绑定策略）给出冲突解决方案
- 📋 **多格式报告**: 支持生成JSON和HTML格式的冲突报告

### 冲突解决功能（新!）
- ✨ **符号前缀注入**: 自动生成wrapper库给冲突符号添加前缀
- 🔧 **两种注入方法**:
  - `ld --wrap`: 使用链接器--wrap选项
  - `Version Script`: 使用GNU版本脚本
- 📝 **自动生成构建脚本**: 生成Makefile片段和编译指令
- 🖥️ **跨平台**: 支持Linux、macOS和Windows

## 安装

```bash
git clone <repository-url>
cd symconflict
cargo build --release
```

编译后的可执行文件位于 `target/release/symconflict`

## 使用方法

### 1. 分析符号冲突

```bash
# 基本分析
symconflict analyze --target <可执行文件路径>

# 生成HTML报告
symconflict analyze --target /path/to/binary --html report.html

# 详细输出
symconflict analyze --target /path/to/binary --verbose

# 严格版本模式（相同基名不同版本不算冲突）
symconflict analyze --target /path/to/binary --strict-version
```

### 2. 符号前缀注入（解决冲突）

```bash
# 基本用法：给指定符号添加前缀
symconflict prefix --target /path/to/binary --symbols func1,func2,global_var

# 指定前缀
symconflict prefix --target /path/to/binary --symbols func1 --prefix mylib_

# 指定输出目录
symconflict prefix --target /path/to/binary --symbols func1 --output ./my_wrappers

# 使用Version Script方法
symconflict prefix --target /path/to/binary --symbols func1 --method version-script

# 同时使用两种方法
symconflict prefix --target /path/to/binary --symbols func1 --method both
```

### 命令行选项详解

#### analyze 子命令
```
--target <PATH>        目标可执行文件或动态库路径
--json <PATH>          输出JSON报告路径
--html <PATH>          输出HTML报告路径
--verbose              详细输出模式
--no-native-elf        禁用原生ELF解析（使用nm/readelf命令）
--strict-version       严格版本模式（相同基名不同版本不算冲突）
```

#### prefix 子命令
```
--target <PATH>        目标可执行文件路径
--prefix <STRING>      符号前缀（默认: myapp_）
--symbols <LIST>       目标符号列表（逗号分隔，如func1,func2）
--library <PATH>       符号所属的库路径（定向修改）
--output <PATH>        输出目录（默认: symconflict_out）
--method <METHOD>      注入方法: ld-wrap, version-script, both
--verbose              详细输出模式
```

## 工作原理

### 符号前缀注入方法

#### 1. ld --wrap 方法
- 生成 `__wrap_symbol` 包装函数
- 链接时使用 `-Wl,--wrap=symbol`
- 调用 `__real_symbol` 获取真实符号
- 提供前缀别名 `prefix_symbol`

#### 2. Version Script 方法
- 使用 `.symver` 汇编指令创建版本化符号
- 版本脚本控制符号可见性
- `global` 导出前缀符号，`local` 隐藏原始符号

## 生成的文件

执行prefix命令后，输出目录包含：

```
symconflict_out/
├── symbol_wrapper.c          # ld --wrap 方式的包装代码
├── wrap_symbols.ld           # 链接器脚本
├── libsymbol_wrapper.so      # 编译后的wrapper库
├── version_wrapper.c         # Version Script方式的包装代码
├── symbol_versions.map       # 版本脚本
├── libversion_wrapper.so     # 版本化wrapper库
└── Makefile.snippet          # Makefile集成片段
```

## 使用生成的Wrapper

### 方法1: 重新链接（推荐）

```bash
# 在你的Makefile中添加
include symconflict_out/Makefile.snippet
LDFLAGS += $(SYMCONFLICT_LDFLAGS) $(SYMCONFLICT_LIB)
```

### 方法2: LD_PRELOAD测试

```bash
# 测试效果，不重新编译
LD_PRELOAD=./symconflict_out/libsymbol_wrapper.so ./your_program
```

## 平台特定工具要求

### Linux
- `ldd`: 用于解析动态库依赖
- `nm`: 用于提取符号表
- `gcc`: 编译wrapper库

### macOS
- `otool`: 用于解析动态库依赖
- `nm`: 用于提取符号表

### Windows
- `dumpbin`: （Visual Studio工具）用于解析依赖和提取符号
- `llvm-nm`: （备选）LLVM的nm工具

## 冲突严重程度

- **高风险**: 全局变量冲突（可能导致数据损坏和未定义行为）
- **中风险**: 非弱函数冲突（可能导致调用错误的实现）
- **低风险**: 弱符号冲突（链接器通常能正确处理）

## 项目结构

```
src/
├── main.rs          # 主程序入口
├── cli.rs           # 命令行参数解析（子命令支持）
├── error.rs         # 错误处理
├── platform.rs      # 平台检测和工具执行
├── dependency.rs    # 依赖解析
├── elf.rs           # ELF文件原生解析（支持版本符号）
├── symbol.rs        # 符号提取
├── conflict.rs      # 冲突检测和分析
├── prefix_inject.rs # 符号前缀注入（核心新功能）
└── report.rs        # 报告生成
```

## 版本历史

- **v0.3.0**: 添加符号前缀注入功能，支持ld --wrap和Version Script方法
- **v0.2.0**: 支持ELF版本符号解析，改进STB_WEAK处理
- **v0.1.0**: 初始版本，基本符号冲突检测

## 许可证

MIT
