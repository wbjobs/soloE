import asyncio
from pathlib import Path
from typing import List, Optional, Tuple
from .parser import CodeParser
from .models import AnalysisResult, AnalysisReport, CodeSmell
from .detectors import (
    LongFunctionDetector,
    TooManyParametersDetector,
    DeepNestingDetector,
    GodClassDetector,
    DuplicateCodeDetector
)
from .ai_refactor import OllamaRefactor


class CodeSmellAnalyzer:
    def __init__(self, 
                 max_function_lines: int = 50,
                 max_params: int = 5,
                 max_nesting: int = 4,
                 max_class_methods: int = 20,
                 max_class_attributes: int = 15,
                 duplicate_min_lines: int = 6,
                 duplicate_similarity: float = 0.85,
                 enable_ai: bool = False,
                 ai_model: str = "qwen2.5-coder:7b",
                 ai_max_concurrent: int = 3,
                 ai_max_batch_size: int = 5,
                 enable_cache: bool = True):
        
        self.parser = CodeParser()
        self.detectors = [
            LongFunctionDetector(max_lines=max_function_lines),
            TooManyParametersDetector(max_params=max_params),
            DeepNestingDetector(max_depth=max_nesting),
            GodClassDetector(max_methods=max_class_methods, max_attributes=max_class_attributes),
            DuplicateCodeDetector(min_lines=duplicate_min_lines, similarity_threshold=duplicate_similarity)
        ]
        
        self.enable_ai = enable_ai
        self.ai_max_concurrent = ai_max_concurrent
        self.ai_max_batch_size = ai_max_batch_size
        self.enable_cache = enable_cache
        
        self.ai_refactor = None
        if enable_ai:
            self.ai_refactor = OllamaRefactor(
                model=ai_model,
                max_concurrent=ai_max_concurrent,
                max_batch_size=ai_max_batch_size,
                enable_cache=enable_cache
            )
        
        self.ai_stats = {}

    def analyze_file(self, file_path: str) -> Optional[AnalysisResult]:
        """分析单个文件（同步方法，不启用AI）"""
        path = Path(file_path)
        if not path.exists() or not path.is_file():
            return None

        extension = path.suffix.lower()
        if extension not in ('.py', '.js', '.jsx', '.ts', '.tsx'):
            return None

        language = "Python" if extension == '.py' else "JavaScript"
        
        tree, code = self.parser.parse_file(file_path)
        if tree is None:
            return None

        result = AnalysisResult(
            file_path=str(path),
            language=language,
            total_lines=code.count('\n') + 1
        )

        all_smells: List[CodeSmell] = []
        for detector in self.detectors:
            smells = detector.detect(tree, code, str(path))
            all_smells.extend(smells)

        result.smells = all_smells
        result.calculate_stats()

        return result

    async def analyze_file_async(self, file_path: str) -> Optional[AnalysisResult]:
        """异步分析单个文件（用于批量处理）"""
        return self.analyze_file(file_path)

    async def analyze_paths_async(self, paths: List[str], recursive: bool = True, 
                                  show_progress=None) -> AnalysisReport:
        """异步分析路径列表，并在最后批量处理AI重构建议"""
        report = AnalysisReport(files_analyzed=0, total_smells=0)
        
        # 第一步：收集所有待分析的文件
        all_files = []
        for path_str in paths:
            path = Path(path_str)
            if path.is_file():
                all_files.append(str(path))
            elif path.is_dir():
                glob_pattern = '**/*' if recursive else '*'
                for file_path in path.glob(glob_pattern):
                    if file_path.is_file():
                        all_files.append(str(file_path))
        
        # 第二步：并行分析所有文件（不包含AI）
        tasks = [self.analyze_file_async(f) for f in all_files]
        if show_progress:
            show_progress(0, len(tasks))
        
        results = []
        for i, task in enumerate(asyncio.as_completed(tasks), 1):
            result = await task
            if result:
                results.append(result)
            if show_progress:
                show_progress(i, len(tasks))
        
        report.results = results
        report.calculate_overall()

        # 第三步：批量处理AI重构建议
        if self.enable_ai and self.ai_refactor:
            # 检查AI服务可用
            try:
                is_available = await self.ai_refactor.is_available()
                if is_available:
                    # 收集所有异味
                    all_smells_with_lang: List[Tuple[CodeSmell, str]] = []
                    for result in report.results:
                        for smell in result.smells:
                            all_smells_with_lang.append((smell, result.language))
                    
                    # 批量处理所有异味
                    if all_smells_with_lang:
                        await self.ai_refactor.enrich_smells_batch(all_smells_with_lang)
                        self.ai_stats = self.ai_refactor.get_stats()
            except Exception:
                # AI处理失败，静默忽略，保持无重构建议的结果
                pass

        return report

    def analyze_directory(self, dir_path: str, recursive: bool = True) -> AnalysisReport:
        """同步方法（兼容旧API）"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self.analyze_paths_async([dir_path], recursive))
        finally:
            loop.close()

    def analyze_paths(self, paths: List[str], recursive: bool = True) -> AnalysisReport:
        """同步方法（兼容旧API）"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(self.analyze_paths_async(paths, recursive))
        finally:
            loop.close()

    def get_ai_stats(self) -> dict:
        """获取AI处理统计信息"""
        return self.ai_stats
