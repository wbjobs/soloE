import json
import hashlib
import asyncio
import aiohttp
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict
from pathlib import Path
from .models import CodeSmell


class RefactorCache:
    """重构建议缓存 - 基于代码内容哈希"""
    
    def __init__(self, cache_file: Optional[str] = None):
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.cache_file = cache_file or str(Path.home() / ".codesmell_cache.json")
        self._load_cache()
    
    def _get_cache_key(self, smell: CodeSmell, language: str) -> str:
        """生成缓存键 - 基于代码内容和异味类型"""
        content = f"{language}:{smell.smell_type}:{smell.code_snippet.strip()}"
        return hashlib.md5(content.encode('utf-8')).hexdigest()
    
    def get(self, smell: CodeSmell, language: str) -> Optional[Dict[str, Any]]:
        """从缓存获取结果"""
        key = self._get_cache_key(smell, language)
        return self.cache.get(key)
    
    def set(self, smell: CodeSmell, language: str, result: Dict[str, Any]):
        """保存结果到缓存"""
        key = self._get_cache_key(smell, language)
        self.cache[key] = result
        self._save_cache()
    
    def _load_cache(self):
        """加载缓存文件"""
        try:
            path = Path(self.cache_file)
            if path.exists():
                with open(path, 'r', encoding='utf-8') as f:
                    self.cache = json.load(f)
        except Exception:
            self.cache = {}
    
    def _save_cache(self):
        """保存缓存文件"""
        try:
            path = Path(self.cache_file)
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(self.cache, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
    
    def get_stats(self) -> Dict[str, int]:
        """获取缓存统计"""
        return {"total_entries": len(self.cache)}


class BatchRequestBuilder:
    """批处理请求构建器 - 合并相似异味"""
    
    SMELL_TYPE_DESCRIPTIONS = {
        "long_function": "过长函数 - 函数代码行数过多，难以理解和维护",
        "too_many_parameters": "过多参数 - 函数参数列表过长，增加调用复杂度",
        "deep_nesting": "深层嵌套 - 控制流嵌套层次过深，降低可读性",
        "god_class": "上帝类 - 类过于庞大，承担了过多职责",
        "duplicate_code": "重复代码 - 代码块重复出现，增加维护成本"
    }
    
    @staticmethod
    def group_smells(smells_with_lang: List[Tuple[CodeSmell, str]], 
                     max_per_batch: int = 5) -> List[List[Tuple[CodeSmell, str]]]:
        """按异味类型分组，然后分批处理"""
        grouped = defaultdict(list)
        
        for smell, language in smells_with_lang:
            key = f"{language}:{smell.smell_type}"
            grouped[key].append((smell, language))
        
        batches = []
        for group in grouped.values():
            for i in range(0, len(group), max_per_batch):
                batches.append(group[i:i + max_per_batch])
        
        return batches
    
    @staticmethod
    def build_batch_prompt(batch: List[Tuple[CodeSmell, str]]) -> Tuple[str, List[Tuple[CodeSmell, str]]]:
        """构建批量请求的prompt"""
        if len(batch) == 1:
            smell, language = batch[0]
            return BatchRequestBuilder._build_single_prompt(smell, language), batch
        
        language = batch[0][1]
        smell_type = batch[0][0].smell_type
        description = BatchRequestBuilder.SMELL_TYPE_DESCRIPTIONS.get(smell_type, smell_type)
        
        prompt_parts = [
            f"你是一位专业的代码重构专家。请针对以下{len(batch)}个{language}代码异味提供重构建议：",
            f"异味类型: {description}",
            "",
            "请按以下JSON格式返回结果（不要返回其他内容），返回一个JSON数组，每个元素对应一个代码异味：",
            "[",
        ]
        
        for idx, (smell, _) in enumerate(batch):
            prompt_parts.append(f"  {{")
            prompt_parts.append(f'    "index": {idx},')
            prompt_parts.append(f'    "suggestion": "针对第{idx+1}个代码片段的重构建议",')
            prompt_parts.append(f'    "example": "重构后的示例代码",')
            prompt_parts.append(f'    "benefits": ["好处1", "好处2", "好处3"]')
            prompt_parts.append(f"  }}{',' if idx < len(batch)-1 else ''}")
        
        prompt_parts.append("]")
        prompt_parts.append("")
        prompt_parts.append("代码异味片段列表：")
        prompt_parts.append("")
        
        for idx, (smell, _) in enumerate(batch):
            prompt_parts.append(f"=== 代码异味 {idx+1} ===")
            prompt_parts.append(f"问题描述: {smell.description}")
            prompt_parts.append("代码片段:")
            prompt_parts.append(f"```{language.lower()}")
            prompt_parts.append(smell.code_snippet)
            prompt_parts.append("```")
            prompt_parts.append("")
        
        return "\n".join(prompt_parts), batch
    
    @staticmethod
    def _build_single_prompt(smell: CodeSmell, language: str) -> str:
        """构建单个请求的prompt"""
        description = BatchRequestBuilder.SMELL_TYPE_DESCRIPTIONS.get(smell.smell_type, smell.smell_type)
        
        return f"""你是一位专业的代码重构专家。请针对以下{language}代码异味提供重构建议：

代码异味类型: {description}
问题描述: {smell.description}

有问题的代码片段:
```{language.lower()}
{smell.code_snippet}
```

请按以下JSON格式返回结果（不要返回其他内容）:
{{
  "suggestion": "详细的重构建议，说明为什么需要重构以及具体的重构策略",
  "example": "重构后的示例代码，展示正确的实现方式",
  "benefits": ["好处1", "好处2", "好处3"]
}}
"""
    
    @staticmethod
    def parse_batch_response(response_text: str, batch_size: int) -> List[Dict[str, Any]]:
        """解析批量响应"""
        try:
            start_idx = response_text.find('[')
            end_idx = response_text.rfind(']') + 1
            
            if start_idx != -1 and end_idx > start_idx:
                json_str = response_text[start_idx:end_idx]
                parsed = json.loads(json_str)
                
                if isinstance(parsed, list) and len(parsed) == batch_size:
                    return parsed
        except json.JSONDecodeError:
            pass
        
        return [BatchRequestBuilder._parse_single_response(response_text) for _ in range(batch_size)]
    
    @staticmethod
    def _parse_single_response(response_text: str) -> Dict[str, Any]:
        """解析单个响应"""
        try:
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1
            if start_idx != -1 and end_idx > start_idx:
                json_str = response_text[start_idx:end_idx]
                return json.loads(json_str)
        except json.JSONDecodeError:
            pass
        
        return {
            "suggestion": response_text,
            "example": None,
            "benefits": []
        }


class AsyncOllamaClient:
    """异步Ollama客户端 - 带并发控制"""
    
    def __init__(self, model: str = "qwen2.5-coder:7b", 
                 base_url: str = "http://localhost:11434",
                 max_concurrent: int = 3):
        self.model = model
        self.base_url = base_url
        self.api_endpoint = f"{base_url}/api/generate"
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
    
    async def is_available(self) -> bool:
        """检查服务是否可用"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.base_url}/api/tags", timeout=5) as response:
                    return response.status == 200
        except Exception:
            return False
    
    async def generate(self, prompt: str, timeout: int = 120) -> str:
        """异步生成，带并发限制"""
        async with self.semaphore:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        self.api_endpoint,
                        json={
                            "model": self.model,
                            "prompt": prompt,
                            "stream": False,
                            "temperature": 0.3,
                            "max_tokens": 2000
                        },
                        timeout=aiohttp.ClientTimeout(total=timeout)
                    ) as response:
                        if response.status == 200:
                            data = await response.json()
                            return data.get("response", "")
                        else:
                            return ""
            except Exception:
                return ""


class OptimizedOllamaRefactor:
    """优化后的Ollama重构建议生成器"""
    
    def __init__(self, model: str = "qwen2.5-coder:7b", 
                 base_url: str = "http://localhost:11434",
                 max_concurrent: int = 3,
                 max_batch_size: int = 5,
                 enable_cache: bool = True):
        self.client = AsyncOllamaClient(model, base_url, max_concurrent)
        self.cache = RefactorCache() if enable_cache else None
        self.max_batch_size = max_batch_size
        self.stats = {
            "cache_hits": 0,
            "cache_misses": 0,
            "batches_processed": 0,
            "total_smells": 0
        }
    
    async def is_available(self) -> bool:
        return await self.client.is_available()
    
    async def enrich_smells_batch(self, smells_with_lang: List[Tuple[CodeSmell, str]]) -> List[CodeSmell]:
        """批量处理异味列表"""
        if not smells_with_lang:
            return []
        
        self.stats["total_smells"] = len(smells_with_lang)
        results: Dict[int, Dict[str, Any]] = {}
        to_process: List[Tuple[int, CodeSmell, str]] = []
        
        # 第一步：检查缓存
        for idx, (smell, language) in enumerate(smells_with_lang):
            if self.cache:
                cached = self.cache.get(smell, language)
                if cached:
                    results[idx] = cached
                    self.stats["cache_hits"] += 1
                    continue
            
            to_process.append((idx, smell, language))
            self.stats["cache_misses"] += 1
        
        # 第二步：构建批次并处理
        if to_process:
            process_list = [(smell, lang) for _, smell, lang in to_process]
            batches = BatchRequestBuilder.group_smells(process_list, self.max_batch_size)
            self.stats["batches_processed"] = len(batches)
            
            tasks = []
            for batch in batches:
                task = self._process_batch(batch)
                tasks.append(task)
            
            batch_results = await asyncio.gather(*tasks)
            
            # 映射结果回原始索引
            process_idx = 0
            for batch_result in batch_results:
                for result in batch_result:
                    original_idx, smell, lang = to_process[process_idx]
                    results[original_idx] = result
                    
                    if self.cache:
                        self.cache.set(smell, lang, result)
                    
                    process_idx += 1
        
        # 第三步：应用结果到smell对象
        for idx, (smell, _) in enumerate(smells_with_lang):
            if idx in results:
                result = results[idx]
                if "error" not in result:
                    smell.refactor_suggestion = result.get("suggestion", "")
                    smell.refactor_example = result.get("example", "")
        
        return [s for s, _ in smells_with_lang]
    
    async def _process_batch(self, batch: List[Tuple[CodeSmell, str]]) -> List[Dict[str, Any]]:
        """处理单个批次"""
        prompt, _ = BatchRequestBuilder.build_batch_prompt(batch)
        response_text = await self.client.generate(prompt)
        
        if len(batch) == 1:
            result = BatchRequestBuilder._parse_single_response(response_text)
            return [result]
        else:
            return BatchRequestBuilder.parse_batch_response(response_text, len(batch))
    
    def enrich_smell_with_refactor(self, smell: CodeSmell, language: str) -> CodeSmell:
        """同步方法（兼容旧API）"""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(self.enrich_smells_batch([(smell, language)]))
            return result[0] if result else smell
        finally:
            loop.close()
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        stats = self.stats.copy()
        if self.cache:
            stats["cache_entries"] = self.cache.get_stats()["total_entries"]
        
        if stats["cache_hits"] + stats["cache_misses"] > 0:
            total = stats["cache_hits"] + stats["cache_misses"]
            stats["cache_hit_rate"] = f"{stats['cache_hits'] / total * 100:.1f}%"
        
        return stats


# 保留向后兼容
OllamaRefactor = OptimizedOllamaRefactor
