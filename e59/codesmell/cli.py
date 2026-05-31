import click
import sys
import asyncio
from pathlib import Path

from .analyzer import CodeSmellAnalyzer
from .formatter import ConsoleFormatter, JsonFormatter
from .ai_refactor import OllamaRefactor
from .refactor import CodeRefactorApplier
from colorama import Fore, Style


@click.group()
@click.version_option(version="0.2.0", prog_name="codesmell")
def cli():
    """代码异味分析工具 - 分析Python和JavaScript代码"""
    pass


@cli.command()
@click.argument('paths', nargs=-1, type=click.Path(exists=True), required=True)
@click.option('--recursive/--no-recursive', default=True, help='递归扫描目录')
@click.option('--json', 'output_json', is_flag=True, help='输出JSON格式')
@click.option('--output', '-o', type=click.Path(), help='输出文件路径')
@click.option('--ai/--no-ai', default=False, help='启用AI重构建议（需要Ollama）')
@click.option('--ai-model', default='qwen2.5-coder:7b', help='AI模型名称')
@click.option('--ai-max-concurrent', default=3, type=int, help='最大并发请求数')
@click.option('--ai-max-batch-size', default=5, type=int, help='每批处理的异味数')
@click.option('--no-cache', is_flag=True, help='禁用缓存')
@click.option('--show-code/--no-show-code', default=True, help='显示代码片段')
@click.option('--show-refactor/--no-show-refactor', default=True, help='显示重构建议')
@click.option('--max-function-lines', default=50, type=int, help='函数最大行数阈值')
@click.option('--max-params', default=5, type=int, help='函数最大参数阈值')
@click.option('--max-nesting', default=4, type=int, help='最大嵌套深度阈值')
@click.option('--max-class-methods', default=20, type=int, help='类最大方法数阈值')
@click.option('--max-class-attributes', default=15, type=int, help='类最大属性数阈值')
@click.option('--duplicate-min-lines', default=6, type=int, help='重复代码最小行数')
@click.option('--duplicate-similarity', default=0.85, type=float, help='重复代码相似度阈值')
def analyze(paths, recursive, output_json, output, ai, ai_model, ai_max_concurrent, 
            ai_max_batch_size, no_cache, show_code, show_refactor,
            max_function_lines, max_params, max_nesting, max_class_methods, max_class_attributes,
            duplicate_min_lines, duplicate_similarity):
    """分析代码中的代码异味"""
    
    analyzer = CodeSmellAnalyzer(
        max_function_lines=max_function_lines,
        max_params=max_params,
        max_nesting=max_nesting,
        max_class_methods=max_class_methods,
        max_class_attributes=max_class_attributes,
        duplicate_min_lines=duplicate_min_lines,
        duplicate_similarity=duplicate_similarity,
        enable_ai=ai,
        ai_model=ai_model,
        ai_max_concurrent=ai_max_concurrent,
        ai_max_batch_size=ai_max_batch_size,
        enable_cache=not no_cache
    )

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        with click.progressbar(length=100, label='正在分析代码...', 
                              bar_template='%(label)s [%(bar)s] %(info)s') as bar:
            
            def progress_callback(current, total):
                if total > 0:
                    progress = int((current / total) * 100)
                    bar.update(progress - bar.length)
            
            report = loop.run_until_complete(
                analyzer.analyze_paths_async(list(paths), recursive, progress_callback)
            )
            
            if bar.length < 100:
                bar.update(100 - bar.length)

    finally:
        loop.close()

    if output_json:
        json_output = JsonFormatter.format_report(report)
        if output:
            JsonFormatter.save_report(report, output)
            click.echo(f"报告已保存到: {output}")
        else:
            click.echo(json_output)
    else:
        if output:
            JsonFormatter.save_report(report, output)
            click.echo(f"JSON报告已保存到: {output}")
            click.echo()
        
        ConsoleFormatter.print_report(report, show_code=show_code, show_refactor=show_refactor)
        
        if ai:
            ai_stats = analyzer.get_ai_stats()
            if ai_stats:
                click.echo()
                click.echo(f"{Fore.CYAN}{Style.BRIGHT}=== AI处理统计 ===")
                click.echo(f"总异味数: {ai_stats.get('total_smells', 0)}")
                click.echo(f"缓存命中: {ai_stats.get('cache_hits', 0)}")
                click.echo(f"实际请求: {ai_stats.get('cache_misses', 0)}")
                click.echo(f"批次数: {ai_stats.get('batches_processed', 0)}")
                if 'cache_hit_rate' in ai_stats:
                    click.echo(f"缓存命中率: {ai_stats['cache_hit_rate']}")

    sys.exit(0)


@cli.command()
@click.argument('file_path', type=click.Path(exists=True))
@click.option('--smell-index', '-s', type=int, default=1, help='要重构的异味序号（默认第一个）')
@click.option('--apply/--dry-run', default=False, help='应用重构修改（默认只预览）')
@click.option('--max-function-lines', default=50, type=int, help='函数最大行数阈值')
def refactor(file_path, smell_index, apply, max_function_lines):
    """自动重构代码（支持过长函数提取等）"""
    
    click.echo(f"分析文件: {file_path}")
    click.echo()
    
    analyzer = CodeSmellAnalyzer(
        max_function_lines=max_function_lines,
        enable_ai=False
    )
    
    result = analyzer.analyze_file(file_path)
    
    if not result or not result.smells:
        click.echo(click.style("未发现任何代码异味", fg="green"))
        return
    
    # 过滤支持自动重构的异味
    refactorable_smells = [s for s in result.smells if s.smell_type in ("long_function",)]
    
    if not refactorable_smells:
        click.echo(click.style("当前版本仅支持 '过长函数(long_function)' 的自动重构", fg="yellow"))
        click.echo("发现的其他异味:")
        for smell in result.smells:
            click.echo(f"  - {smell.smell_type}: {smell.description}")
        return
    
    if smell_index < 1 or smell_index > len(refactorable_smells):
        click.echo(click.style(f"无效的异味序号，请选择 1 到 {len(refactorable_smells)} 之间的数字", fg="red"))
        for i, smell in enumerate(refactorable_smells, 1):
            click.echo(f"  [{i}] {smell.smell_type}: 第{smell.start_line}-{smell.end_line}行 - {smell.description}")
        return
    
    smell = refactorable_smells[smell_index - 1]
    
    click.echo(f"{Fore.CYAN}{Style.BRIGHT}=== 发现可重构的异味 ===")
    click.echo(f"类型: {smell.smell_type}")
    click.echo(f"位置: 第 {smell.start_line}-{smell.end_line} 行")
    click.echo(f"描述: {smell.description}")
    click.echo()
    
    applier = CodeRefactorApplier()
    
    with click.progressbar(length=1, label='执行重构...') as bar:
        refactor_result = applier.apply_refactor(
            file_path,
            smell,
            result.language,
            dry_run=not apply
        )
        bar.update(1)
    
    if not refactor_result["success"]:
        click.echo(click.style(f"重构失败: {refactor_result.get('error', '未知错误')}", fg="red"))
        return
    
    click.echo()
    click.echo(click.style("✓ " + refactor_result["message"], fg="green"))
    click.echo()
    
    # 显示变更摘要
    click.echo(f"{Fore.CYAN}{Style.BRIGHT}=== 变更摘要 ===")
    for i, change in enumerate(refactor_result["changes"], 1):
        click.echo(f"[{i}] {change['description']}")
        click.echo(f"    行号: {change['start_line']}-{change['end_line']}")
    click.echo()
    
    # 显示diff
    click.echo(f"{Fore.CYAN}{Style.BRIGHT}=== 代码变更对比 ===")
    diff_lines = refactor_result["diff"].split('\n')
    for line in diff_lines:
        if line.startswith('+'):
            click.echo(f"{Fore.GREEN}{line}")
        elif line.startswith('-'):
            click.echo(f"{Fore.RED}{line}")
        elif line.startswith('@@'):
            click.echo(f"{Fore.CYAN}{line}")
        else:
            click.echo(f"{Fore.WHITE}{line}")
    click.echo()
    
    if apply:
        if refactor_result.get("applied", False):
            click.echo(click.style("✓ 重构已应用到文件", fg="green"))
        else:
            click.echo(click.style("✗ 应用重构失败", fg="red"))
    else:
        click.echo(click.style("这是预览模式，文件未被修改。", fg="yellow"))
        click.echo(f"使用 --apply 参数应用修改: codesmell refactor {file_path} -s {smell_index} --apply")


@cli.command()
@click.option('--clear', is_flag=True, help='清除缓存')
def cache(clear):
    """管理重构建议缓存"""
    from .ai_refactor import RefactorCache
    
    if clear:
        cache_file = Path.home() / ".codesmell_cache.json"
        if cache_file.exists():
            cache_file.unlink()
            click.echo(click.style("缓存已清除", fg="green"))
        else:
            click.echo("没有缓存文件")
    else:
        cache = RefactorCache()
        stats = cache.get_stats()
        click.echo(f"缓存条目数: {stats['total_entries']}")
        click.echo(f"缓存文件: {cache.cache_file}")


@cli.command()
def check():
    """检查Ollama服务状态"""
    click.echo("检查Ollama服务状态...")
    
    ollama = OllamaRefactor()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        is_available = loop.run_until_complete(ollama.is_available())
    finally:
        loop.close()
    
    if is_available:
        click.echo(click.style("✓ Ollama服务运行正常", fg="green"))
        
        try:
            import requests
            response = requests.get("http://localhost:11434/api/tags", timeout=5)
            data = response.json()
            models = data.get("models", [])
            if models:
                click.echo(f"\n可用模型:")
                for model in models:
                    click.echo(f"  - {model.get('name', 'unknown')}")
            else:
                click.echo("\n未找到模型列表")
        except Exception as e:
            click.echo(f"无法获取模型列表: {e}")
    else:
        click.echo(click.style("✗ Ollama服务未运行或无法连接", fg="red"))
        click.echo("\n请按以下步骤安装和启动Ollama:")
        click.echo("  1. 从 https://ollama.ai 下载并安装Ollama")
        click.echo("  2. 运行命令: ollama serve")
        click.echo("  3. 拉取模型: ollama pull qwen2.5-coder:7b")
        sys.exit(1)


def main():
    try:
        cli()
    except KeyboardInterrupt:
        click.echo("\n操作已取消")
        sys.exit(0)
    except Exception as e:
        import traceback
        traceback.print_exc()
        click.echo(f"{click.style('错误:', fg='red')} {str(e)}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
