use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "symconflict")]
#[command(author = "symconflict contributors")]
#[command(version = "0.3.0")]
#[command(about = "跨平台动态库符号冲突分析工具", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// 分析符号冲突
    Analyze(AnalyzeArgs),
    
    /// 符号前缀注入（解决冲突）
    Prefix(PrefixArgs),
}

#[derive(Parser, Debug)]
pub struct AnalyzeArgs {
    /// 目标可执行文件或动态库路径
    #[arg(short, long)]
    pub target: PathBuf,

    /// 输出JSON报告路径
    #[arg(short, long)]
    pub json: Option<PathBuf>,

    /// 输出HTML报告路径
    #[arg(short, long)]
    pub html: Option<PathBuf>,

    /// 详细输出模式
    #[arg(short, long)]
    pub verbose: bool,

    /// 禁用原生ELF解析（使用nm/readelf命令）
    #[arg(long)]
    pub no_native_elf: bool,

    /// 按符号版本区分（相同基名不同版本不算冲突）
    #[arg(long)]
    pub strict_version: bool,
}

#[derive(Parser, Debug)]
pub struct PrefixArgs {
    /// 目标可执行文件路径
    #[arg(short, long)]
    pub target: PathBuf,

    /// 要注入的符号前缀（如myapp_）
    #[arg(short, long, default_value = "myapp_")]
    pub prefix: String,

    /// 目标符号列表（逗号分隔，如func1,func2,var1）
    #[arg(short, long)]
    pub symbols: String,

    /// 符号所属的库路径（用于定向修改）
    #[arg(short, long)]
    pub library: Option<PathBuf>,

    /// 输出目录
    #[arg(short, long, default_value = "symconflict_out")]
    pub output: PathBuf,

    /// 注入方法
    #[arg(short, long, value_enum, default_value = "ld-wrap")]
    pub method: InjectMethodChoice,

    /// 详细输出模式
    #[arg(short, long)]
    pub verbose: bool,
}

#[derive(clap::ValueEnum, Clone, Debug, Copy)]
pub enum InjectMethodChoice {
    /// 使用ld --wrap选项
    LdWrap,
    /// 使用Version Script
    VersionScript,
    /// 同时使用两种方法
    Both,
}

pub fn parse_args() -> Cli {
    Cli::parse()
}
