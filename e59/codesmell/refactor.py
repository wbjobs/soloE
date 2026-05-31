import re
import difflib
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from pathlib import Path
from tree_sitter import Node
from .parser import get_node_text, CodeParser


@dataclass
class RefactorChange:
    """表示一个重构变更"""
    file_path: str
    start_line: int
    end_line: int
    original_code: str
    new_code: str
    description: str
    refactor_type: str


@dataclass
class RefactorResult:
    """重构结果"""
    success: bool
    changes: List[RefactorChange]
    message: str = ""
    error: Optional[str] = None


class BaseRefactor(ABC):
    """重构器基类"""
    
    def __init__(self, parser: CodeParser, code: str, file_path: str, language: str = "python"):
        self.parser = parser
        self.original_code = code
        self.file_path = file_path
        self.language = language.lower()
        self.lines = code.split('\n')
    
    @abstractmethod
    def can_refactor(self, smell_type: str) -> bool:
        """判断是否能处理该类型的异味"""
        pass
    
    @abstractmethod
    def refactor(self, node: Node, smell_type: str, **kwargs) -> RefactorResult:
        """执行重构"""
        pass
    
    def validate_code(self, code: str) -> bool:
        """验证代码语法正确性"""
        try:
            if self.language == "python":
                tree = self.parser.python_parser.parse(bytes(code, 'utf-8'))
            elif self.language in ("javascript", "js"):
                tree = self.parser.javascript_parser.parse(bytes(code, 'utf-8'))
            else:
                return False
            
            return not tree.root_node.has_error
        except Exception:
            return False
    
    def apply_changes(self, changes: List[RefactorChange]) -> str:
        """应用多个变更（按行倒序处理，避免行号偏移问题）"""
        sorted_changes = sorted(changes, key=lambda c: -c.end_line)
        current_lines = self.lines.copy()
        
        for change in sorted_changes:
            start_idx = change.start_line - 1
            end_idx = change.end_line
            new_lines = change.new_code.split('\n')
            current_lines = current_lines[:start_idx] + new_lines + current_lines[end_idx:]
        
        return '\n'.join(current_lines)
    
    def get_diff(self, changes: List[RefactorChange]) -> str:
        """生成变更的diff"""
        original = self.original_code
        new_code = self.apply_changes(changes)
        
        original_lines = original.split('\n')
        new_lines = new_code.split('\n')
        
        diff = difflib.unified_diff(
            original_lines,
            new_lines,
            fromfile=self.file_path + " (original)",
            tofile=self.file_path + " (refactored)",
            lineterm=''
        )
        
        return '\n'.join(diff)


class LongFunctionRefactor(BaseRefactor):
    """过长函数重构器 - 自动提取子函数"""
    
    def can_refactor(self, smell_type: str) -> bool:
        return smell_type == "long_function"
    
    def refactor(self, node: Node, smell_type: str, **kwargs) -> RefactorResult:
        if self.language != "python":
            return RefactorResult(
                success=False,
                changes=[],
                error="目前仅支持Python函数提取"
            )
        
        function_name = self._get_function_name(node)
        function_body = self._find_function_body(node)
        
        if not function_body:
            return RefactorResult(
                success=False,
                changes=[],
                error="无法找到函数体"
            )
        
        extractable_blocks = self._find_extractable_blocks(function_body)
        
        if not extractable_blocks:
            return RefactorResult(
                success=False,
                changes=[],
                error="未找到适合提取的代码块（需要>=3行的if/for/while）"
            )
        
        changes = []
        func_end_line = node.end_point[0] + 1
        extracted_functions = []
        
        # 只提取第一个块，避免过度重构
        block = extractable_blocks[0]
        extracted_func_name = f"_{function_name}_part"
        
        block_lines = get_node_text(block, self.original_code)
        extracted_func = self._generate_extracted_function(extracted_func_name, block)
        extracted_functions.append(extracted_func)
        
        call_code = f"{extracted_func_name}()"
        
        start_line, end_line = block.start_point[0] + 1, block.end_point[0] + 1
        
        # 生成调用代码，保留原始缩进
        first_line = block_lines.split('\n')[0]
        indent = len(first_line) - len(first_line.lstrip())
        indented_call = ' ' * indent + call_code
        
        changes.append(RefactorChange(
            file_path=self.file_path,
            start_line=start_line,
            end_line=end_line,
            original_code=block_lines,
            new_code=indented_call,
            description=f"提取代码块为函数 {extracted_func_name}",
            refactor_type="extract_function"
        ))
        
        if extracted_functions:
            all_extracted = "\n\n\n".join(extracted_functions)
            # 在原始函数后面添加空行后插入
            changes.append(RefactorChange(
                file_path=self.file_path,
                start_line=func_end_line + 1,
                end_line=func_end_line,
                original_code="",
                new_code="\n\n" + all_extracted,
                description="插入提取的子函数",
                refactor_type="insert_extracted_function"
            ))
        
        new_code = self.apply_changes(changes)
        if not self.validate_code(new_code):
            return RefactorResult(
                success=False,
                changes=[],
                error="重构后代码语法验证失败"
            )
        
        return RefactorResult(
            success=True,
            changes=changes,
            message=f"成功从函数 '{function_name}' 中提取了 {len(extracted_functions)} 个子函数"
        )
    
    def _get_function_name(self, node: Node) -> str:
        for child in node.children:
            if child.type == "identifier":
                return child.text.decode('utf-8', errors='ignore')
        return "unknown_function"
    
    def _find_function_body(self, node: Node) -> Optional[Node]:
        for child in node.children:
            if child.type == "block":
                return child
        return None
    
    def _find_extractable_blocks(self, body_node: Node) -> List[Node]:
        blocks = []
        
        for child in body_node.children:
            if child.type in ("if_statement", "for_statement", "while_statement", "with_statement"):
                start_line = child.start_point[0]
                end_line = child.end_point[0]
                if end_line - start_line >= 2:
                    blocks.append(child)
        
        blocks.sort(key=lambda n: n.end_point[0] - n.start_point[0], reverse=True)
        return blocks
    
    def _generate_extracted_function(self, func_name: str, block_node: Node) -> str:
        body_code = get_node_text(block_node, self.original_code)
        
        lines = body_code.split('\n')
        if not lines:
            return f"def {func_name}():\n    pass"
        
        first_line = lines[0]
        indent = len(first_line) - len(first_line.lstrip())
        
        body_lines = []
        for line in lines:
            if len(line) >= indent:
                body_lines.append(line[indent:])
            else:
                body_lines.append(line)
        
        body_indented = '\n'.join(body_lines)
        body_indented = '\n    '.join(body_indented.split('\n'))
        
        return f"def {func_name}():\n    {body_indented}"


class RefactorManager:
    """重构管理器"""
    
    def __init__(self):
        self.refactorers = {
            "long_function": LongFunctionRefactor
        }
    
    def get_refactorer(self, smell_type: str, parser: CodeParser, code: str, 
                      file_path: str, language: str) -> Optional[BaseRefactor]:
        refactorer_class = self.refactorers.get(smell_type)
        if refactorer_class:
            return refactorer_class(parser, code, file_path, language)
        return None
    
    def can_refactor(self, smell_type: str) -> bool:
        return smell_type in self.refactorers


class CodeRefactorApplier:
    """代码重构应用器"""
    
    def __init__(self):
        self.manager = RefactorManager()
        self.parser = CodeParser()
    
    def apply_refactor(self, file_path: str, smell, language: str,
                       dry_run: bool = True) -> Dict[str, Any]:
        """应用重构"""
        path = Path(file_path)
        if not path.exists():
            return {"success": False, "error": "文件不存在"}
        
        with open(path, 'r', encoding='utf-8') as f:
            code = f.read()
        
        refactorer = self.manager.get_refactorer(
            smell.smell_type,
            self.parser,
            code,
            str(file_path),
            language
        )
        
        if not refactorer:
            return {"success": False, "error": f"不支持的重构类型: {smell.smell_type}"}
        
        tree, _ = self.parser.parse_file(file_path)
        if tree is None:
            return {"success": False, "error": "无法解析代码"}
        
        target_node = self._find_node_at_line(tree, smell.start_line, smell.smell_type)
        
        if not target_node:
            return {"success": False, "error": "无法定位代码节点"}
        
        result = refactorer.refactor(target_node, smell.smell_type, smell=smell)
        
        if not result.success:
            return {"success": False, "error": result.error or "重构失败"}
        
        new_code = refactorer.apply_changes(result.changes)
        diff = refactorer.get_diff(result.changes)
        
        output = {
            "success": True,
            "file_path": str(file_path),
            "changes": [
                {
                    "start_line": c.start_line,
                    "end_line": c.end_line,
                    "description": c.description,
                    "original": c.original_code,
                    "new": c.new_code
                }
                for c in result.changes
            ],
            "original_code": code,
            "refactored_code": new_code,
            "diff": diff,
            "message": result.message,
            "dry_run": dry_run
        }
        
        if not dry_run:
            try:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(new_code)
                output["applied"] = True
            except Exception as e:
                output["applied"] = False
                output["error"] = f"写入文件失败: {str(e)}"
        
        return output
    
    def _find_node_at_line(self, node: Node, line: int, node_type: str = None) -> Optional[Node]:
        node_start = node.start_point[0] + 1
        node_end = node.end_point[0] + 1
        
        if node_start <= line <= node_end:
            if node_type and node.type == node_type:
                return node
            for child in node.children:
                found = self._find_node_at_line(child, line, node_type)
                if found:
                    return found
            if node_type and node_type == "long_function" and node.type in ("function_definition", "method_definition"):
                return node
            return node if not node_type else None
        
        return None
