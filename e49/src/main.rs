mod cli;
mod conflict;
mod dependency;
mod elf;
mod error;
mod platform;
mod prefix_inject;
mod report;
mod symbol;

use chrono::Local;
use cli::{parse_args, Commands, InjectMethodChoice};
use conflict::{ConflictDetector, ConflictReport};
use dependency::DependencyResolver;
use error::Result;
use prefix_inject::{InjectMethod, PrefixConfig, PrefixInjector, SymbolTarget};
use report::ReportGenerator;
use std::collections::HashMap;
use symbol::SymbolExtractor;

fn main() -> Result<()> {
    env_logger::init();

    let args = parse_args();

    match args.command {
        Commands::Analyze(analyze_args) => {
            execute_analyze(analyze_args)?;
        }
        Commands::Prefix(prefix_args) => {
            execute_prefix(prefix_args)?;
        }
    }

    Ok(())
}

fn execute_analyze(args: cli::AnalyzeArgs) -> Result<()> {
    println!("正在分析: {}", args.target.display());
    if args.no_native_elf {
        println!("已禁用原生ELF解析，将使用nm/readelf命令");
    }
    if args.strict_version {
        println!("严格版本模式：相同基名不同版本不算冲突");
    }

    let resolver = DependencyResolver::new();
    let libraries = resolver.resolve(&args.target)?;

    println!("发现 {} 个依赖库", libraries.len());

    let mut load_orders = HashMap::new();
    for lib in &libraries {
        load_orders.insert(lib.path.clone(), lib.load_order);
    }

    let extractor = SymbolExtractor::new()
        .with_native_elf(!args.no_native_elf);
    
    let mut all_symbols = Vec::new();

    for lib in &libraries {
        if args.verbose {
            println!("  提取符号: {}", lib.name);
        }
        match extractor.extract_symbols(&lib.path) {
            Ok(symbols) => {
                if args.verbose {
                    println!("    发现 {} 个符号", symbols.len());
                }
                all_symbols.extend(symbols);
            }
            Err(e) => {
                eprintln!("    警告: 无法提取 {} 的符号: {}", lib.name, e);
            }
        }
    }

    println!("共提取 {} 个符号", all_symbols.len());

    let mut detector = ConflictDetector::new();
    detector.set_load_orders(load_orders.clone());
    detector.set_ignore_version(!args.strict_version);
    let conflicts = detector.detect_conflicts(&all_symbols)?;

    let report = ConflictReport {
        total_libraries: libraries.len(),
        total_symbols: all_symbols.len(),
        total_conflicts: conflicts.len(),
        conflicts: conflicts.clone(),
        generated_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        target_binary: args.target.clone(),
    };

    let generator = ReportGenerator::new();
    generator.print_summary(&report);

    if let Some(json_path) = args.json {
        generator.generate_json(&report, &json_path)?;
        println!("\nJSON报告已生成: {}", json_path.display());
    }

    if let Some(html_path) = args.html {
        generator.generate_html(&report, &html_path)?;
        println!("HTML报告已生成: {}", html_path.display());
    }

    if !conflicts.is_empty() {
        prefix_inject::list_conflicts_for_injection(&conflicts);
        println!("\n提示: 使用 'symconflict prefix --symbols func1,func2' 进行符号前缀注入解决冲突");
    }

    Ok(())
}

fn execute_prefix(args: cli::PrefixArgs) -> Result<()> {
    println!("\n=== 符号前缀注入功能 ===");
    println!("目标文件: {}", args.target.display());
    println!("前缀: {}", args.prefix);
    println!("输出目录: {}", args.output.display());

    let symbol_names: Vec<&str> = args.symbols.split(',').collect();
    println!("目标符号数: {}", symbol_names.len());

    let mut symbol_targets = Vec::new();

    for name in symbol_names {
        let name = name.trim().to_string();
        if !name.is_empty() {
            symbol_targets.push(SymbolTarget {
                name: name.clone(),
                library: args.library.clone().unwrap_or_default(),
                is_function: true,
            });
            println!("  - {}", name);
        }
    }

    if symbol_targets.is_empty() {
        eprintln!("错误: 没有指定有效符号");
        std::process::exit(1);
    }

    let method = match args.method {
        InjectMethodChoice::LdWrap => InjectMethod::LdWrap,
        InjectMethodChoice::VersionScript => InjectMethod::VersionScript,
        InjectMethodChoice::Both => InjectMethod::Both,
    };

    let config = PrefixConfig {
        prefix: args.prefix,
        symbols: symbol_targets,
        output_dir: args.output,
        target_binary: args.target,
        method,
    };

    let injector = PrefixInjector::new(config);
    injector.execute()?;

    println!("\n✓ 符号前缀注入完成!");
    println!("\n后续步骤:");
    println!("  1. 查看生成的wrapper代码");
    println!("  2. 按照生成的Makefile片段修改构建系统");
    println!("  3. 或者使用 LD_PRELOAD 预加载wrapper库测试");

    Ok(())
}
