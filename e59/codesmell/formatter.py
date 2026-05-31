import json
from typing import Any
from colorama import Fore, Style, init
from .models import AnalysisReport, AnalysisResult, CodeSmell, Severity

init(autoreset=True)


class JsonFormatter:
    @staticmethod
    def format_report(report: AnalysisReport, pretty: bool = True) -> str:
        data = {
            "summary": {
                "files_analyzed": report.files_analyzed,
                "total_smells": report.total_smells,
                "smells_by_type": report.smells_by_type,
                "overall_severity_score": round(report.overall_score, 2)
            },
            "files": []
        }

        for result in report.results:
            file_data = {
                "file_path": result.file_path,
                "language": result.language,
                "total_lines": result.total_lines,
                "smells_count": result.total_smells,
                "avg_severity": round(result.avg_severity, 2),
                "smells": []
            }

            for smell in result.smells:
                smell_data = {
                    "type": smell.smell_type,
                    "severity": smell.severity.value,
                    "severity_score": smell.severity_score,
                    "start_line": smell.start_line,
                    "end_line": smell.end_line,
                    "description": smell.description,
                    "code_snippet": smell.code_snippet
                }

                if smell.refactor_suggestion:
                    smell_data["refactor_suggestion"] = smell.refactor_suggestion
                if smell.refactor_example:
                    smell_data["refactor_example"] = smell.refactor_example

                file_data["smells"].append(smell_data)

            data["files"].append(file_data)

        indent = 2 if pretty else None
        return json.dumps(data, ensure_ascii=False, indent=indent)

    @staticmethod
    def save_report(report: AnalysisReport, output_path: str, pretty: bool = True):
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(JsonFormatter.format_report(report, pretty))


class ConsoleFormatter:
    SEVERITY_COLORS = {
        Severity.LOW: Fore.CYAN,
        Severity.MEDIUM: Fore.YELLOW,
        Severity.HIGH: Fore.LIGHTRED_EX,
        Severity.CRITICAL: Fore.RED + Style.BRIGHT
    }

    SEVERITY_SYMBOLS = {
        Severity.LOW: "◐",
        Severity.MEDIUM: "◒",
        Severity.HIGH: "◓",
        Severity.CRITICAL: "◑"
    }

    SMELL_TYPE_NAMES = {
        "long_function": "过长函数",
        "too_many_parameters": "过多参数",
        "deep_nesting": "深层嵌套",
        "god_class": "上帝类",
        "duplicate_code": "重复代码"
    }

    @classmethod
    def format_report(cls, report: AnalysisReport, show_code: bool = True, show_refactor: bool = True) -> str:
        lines = []
        lines.append(cls._format_header(report))
        lines.append("")

        for result in report.results:
            if result.smells:
                lines.append(cls._format_file_result(result, show_code, show_refactor))
                lines.append("")

        lines.append(cls._format_footer(report))
        return "\n".join(lines)

    @classmethod
    def _format_header(cls, report: AnalysisReport) -> str:
        lines = []
        lines.append(f"{Fore.CYAN}{Style.BRIGHT}{'=' * 70}")
        lines.append(f"{Fore.CYAN}{Style.BRIGHT}   代码异味分析报告")
        lines.append(f"{Fore.CYAN}{Style.BRIGHT}{'=' * 70}")
        lines.append("")
        lines.append(f"{Fore.WHITE}分析文件数: {Fore.GREEN}{report.files_analyzed}")
        lines.append(f"{Fore.WHITE}发现异味数: {Fore.YELLOW}{report.total_smells}")
        
        if report.overall_score > 0:
            severity = Severity.from_score(int(report.overall_score))
            color = cls.SEVERITY_COLORS[severity]
            lines.append(f"{Fore.WHITE}整体严重度: {color}{severity.value.upper()} ({report.overall_score:.1f})")
        
        lines.append("")
        lines.append(f"{Fore.WHITE}异味类型统计:")
        for smell_type, count in report.smells_by_type.items():
            name = cls.SMELL_TYPE_NAMES.get(smell_type, smell_type)
            lines.append(f"  {Fore.LIGHTBLUE_EX}• {name}: {Fore.YELLOW}{count}")
        
        return "\n".join(lines)

    @classmethod
    def _format_file_result(cls, result: AnalysisResult, show_code: bool, show_refactor: bool) -> str:
        lines = []
        lines.append(f"{Fore.MAGENTA}{Style.BRIGHT}{'─' * 70}")
        lines.append(f"{Fore.MAGENTA}{Style.BRIGHT}📄 {result.file_path}")
        lines.append(f"{Fore.MAGENTA}   语言: {result.language} | 行数: {result.total_lines} | 异味: {result.total_smells}")
        lines.append(f"{Fore.MAGENTA}{Style.BRIGHT}{'─' * 70}")

        for i, smell in enumerate(result.smells, 1):
            lines.extend(cls._format_smell(smell, i, show_code, show_refactor))
            lines.append("")

        return "\n".join(lines)

    @classmethod
    def _format_smell(cls, smell: CodeSmell, index: int, show_code: bool, show_refactor: bool) -> list:
        lines = []
        color = cls.SEVERITY_COLORS[smell.severity]
        symbol = cls.SEVERITY_SYMBOLS[smell.severity]
        type_name = cls.SMELL_TYPE_NAMES.get(smell.smell_type, smell.smell_type)

        lines.append(f"{color}{Style.BRIGHT}{symbol} [{index}] {type_name}")
        lines.append(f"{color}   严重度: {smell.severity.value.upper()} ({smell.severity_score}/100)")
        lines.append(f"{color}   位置: 第 {smell.start_line}-{smell.end_line} 行")
        lines.append(f"{Fore.WHITE}   描述: {smell.description}")

        if show_code and smell.code_snippet:
            lines.append("")
            lines.append(f"{Fore.LIGHTBLACK_EX}   代码片段:")
            for line in smell.code_snippet.split('\n'):
                lines.append(f"{Fore.LIGHTBLACK_EX}   | {line}")

        if show_refactor and smell.refactor_suggestion:
            lines.append("")
            lines.append(f"{Fore.GREEN}   💡 重构建议:")
            lines.append(f"{Fore.LIGHTGREEN_EX}   {smell.refactor_suggestion}")

            if smell.refactor_example:
                lines.append("")
                lines.append(f"{Fore.GREEN}   示例代码:")
                for line in smell.refactor_example.split('\n'):
                    lines.append(f"{Fore.LIGHTGREEN_EX}   | {line}")

        return lines

    @classmethod
    def _format_footer(cls, report: AnalysisReport) -> str:
        lines = []
        lines.append(f"{Fore.CYAN}{Style.BRIGHT}{'=' * 70}")
        
        if report.total_smells == 0:
            lines.append(f"{Fore.GREEN}{Style.BRIGHT}🎉 太棒了！没有发现代码异味！")
        else:
            lines.append(f"{Fore.YELLOW}💡 建议: 优先修复严重级别高的异味，逐步改进代码质量。")
        
        lines.append(f"{Fore.CYAN}{Style.BRIGHT}{'=' * 70}")
        return "\n".join(lines)

    @staticmethod
    def print_report(report: AnalysisReport, show_code: bool = True, show_refactor: bool = True):
        print(ConsoleFormatter.format_report(report, show_code, show_refactor))
