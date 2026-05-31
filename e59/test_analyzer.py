import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from codesmell.analyzer import CodeSmellAnalyzer
from codesmell.formatter import ConsoleFormatter

def main():
    print("=" * 60)
    print("代码异味分析工具 - 测试")
    print("=" * 60)
    print()

    test_file = Path(__file__).parent / "test_bad_code.py"
    
    if not test_file.exists():
        print(f"测试文件不存在: {test_file}")
        return

    print(f"正在分析: {test_file}")
    print()

    analyzer = CodeSmellAnalyzer(
        max_function_lines=50,
        max_params=5,
        max_nesting=4,
        max_class_methods=20,
        max_class_attributes=15,
        duplicate_min_lines=6,
        duplicate_similarity=0.85,
        enable_ai=False
    )

    result = analyzer.analyze_file(str(test_file))

    if result:
        from codesmell.models import AnalysisReport
        report = AnalysisReport(files_analyzed=1, total_smells=0)
        report.results.append(result)
        report.calculate_overall()
        
        ConsoleFormatter.print_report(report, show_code=True, show_refactor=False)
    else:
        print("分析失败")

if __name__ == "__main__":
    main()
