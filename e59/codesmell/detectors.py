from typing import List, Optional
from tree_sitter import Node
from pathlib import Path

from .models import CodeSmell, Severity
from .parser import get_node_text, get_node_lines


class BaseSmellDetector:
    def detect(self, node: Node, code: str, file_path: str) -> List[CodeSmell]:
        raise NotImplementedError


class LongFunctionDetector(BaseSmellDetector):
    def __init__(self, max_lines: int = 50):
        self.max_lines = max_lines

    def detect(self, node: Node, code: str, file_path: str) -> List[CodeSmell]:
        smells = []
        self._walk_tree(node, code, file_path, smells)
        return smells

    def _walk_tree(self, node: Node, code: str, file_path: str, smells: List[CodeSmell]):
        if node.type in ('function_definition', 'function_declaration', 'method_definition'):
            start_line, end_line = get_node_lines(node)
            line_count = end_line - start_line + 1

            if line_count > self.max_lines:
                func_name = self._get_function_name(node)
                severity_score = min(100, 30 + (line_count - self.max_lines) * 2)
                
                smells.append(CodeSmell(
                    smell_type="long_function",
                    severity=Severity.from_score(severity_score),
                    severity_score=severity_score,
                    file_path=file_path,
                    start_line=start_line,
                    end_line=end_line,
                    description=f"函数 '{func_name}' 有 {line_count} 行，超过阈值 {self.max_lines} 行",
                    code_snippet=self._get_snippet(node, code)
                ))

        for child in node.children:
            self._walk_tree(child, code, file_path, smells)

    def _get_function_name(self, node: Node) -> str:
        for child in node.children:
            if child.type in ('identifier', 'property_identifier'):
                return child.text.decode('utf-8', errors='ignore')
        return "anonymous"

    def _get_snippet(self, node: Node, code: str, max_lines: int = 10) -> str:
        lines = get_node_text(node, code).split('\n')
        if len(lines) > max_lines:
            return '\n'.join(lines[:max_lines]) + '\n...'
        return get_node_text(node, code)


class TooManyParametersDetector(BaseSmellDetector):
    def __init__(self, max_params: int = 5):
        self.max_params = max_params

    def detect(self, node: Node, code: str, file_path: str) -> List[CodeSmell]:
        smells = []
        self._walk_tree(node, code, file_path, smells)
        return smells

    def _walk_tree(self, node: Node, code: str, file_path: str, smells: List[CodeSmell]):
        if node.type in ('function_definition', 'function_declaration', 'method_definition', 'arrow_function'):
            params = self._get_parameters(node)
            param_count = len(params)

            if param_count > self.max_params:
                func_name = self._get_function_name(node)
                start_line, end_line = get_node_lines(node)
                severity_score = min(100, 40 + (param_count - self.max_params) * 10)

                smells.append(CodeSmell(
                    smell_type="too_many_parameters",
                    severity=Severity.from_score(severity_score),
                    severity_score=severity_score,
                    file_path=file_path,
                    start_line=start_line,
                    end_line=end_line,
                    description=f"函数 '{func_name}' 有 {param_count} 个参数，超过阈值 {self.max_params} 个",
                    code_snippet=self._get_snippet(node, code)
                ))

        for child in node.children:
            self._walk_tree(child, code, file_path, smells)

    def _get_parameters(self, node: Node) -> List[Node]:
        params = []
        for child in node.children:
            if child.type in ('parameters', 'formal_parameters'):
                for param in child.children:
                    if param.type in ('identifier', 'typed_parameter', 'default_parameter', 
                                      'rest_parameter', 'assignment_pattern'):
                        params.append(param)
        return params

    def _get_function_name(self, node: Node) -> str:
        for child in node.children:
            if child.type in ('identifier', 'property_identifier'):
                return child.text.decode('utf-8', errors='ignore')
        return "anonymous"

    def _get_snippet(self, node: Node, code: str) -> str:
        for child in node.children:
            if child.type in ('parameters', 'formal_parameters'):
                return get_node_text(child, code)
        return get_node_text(node, code)[:100]


class DeepNestingDetector(BaseSmellDetector):
    def __init__(self, max_depth: int = 4):
        self.max_depth = max_depth

    def detect(self, node: Node, code: str, file_path: str) -> List[CodeSmell]:
        smells = []
        self._check_nesting(node, code, file_path, smells, 0)
        return smells

    def _check_nesting(self, node: Node, code: str, file_path: str, 
                       smells: List[CodeSmell], depth: int):
        nesting_nodes = (
            'if_statement', 'for_statement', 'while_statement', 
            'try_statement', 'with_statement', 'switch_statement',
            'catch_clause', 'else_clause'
        )

        if node.type in nesting_nodes:
            depth += 1
            if depth > self.max_depth:
                start_line, _ = get_node_lines(node)
                severity_score = min(100, 50 + (depth - self.max_depth) * 15)
                
                smells.append(CodeSmell(
                    smell_type="deep_nesting",
                    severity=Severity.from_score(severity_score),
                    severity_score=severity_score,
                    file_path=file_path,
                    start_line=start_line,
                    end_line=start_line,
                    description=f"嵌套深度为 {depth} 层，超过阈值 {self.max_depth} 层",
                    code_snippet=self._get_snippet(node, code)
                ))

        for child in node.children:
            self._check_nesting(child, code, file_path, smells, depth)

    def _get_snippet(self, node: Node, code: str, max_chars: int = 150) -> str:
        text = get_node_text(node, code)
        if len(text) > max_chars:
            return text[:max_chars] + '...'
        return text


class GodClassDetector(BaseSmellDetector):
    def __init__(self, max_methods: int = 20, max_attributes: int = 15):
        self.max_methods = max_methods
        self.max_attributes = max_attributes

    def detect(self, node: Node, code: str, file_path: str) -> List[CodeSmell]:
        smells = []
        self._walk_tree(node, code, file_path, smells)
        return smells

    def _walk_tree(self, node: Node, code: str, file_path: str, smells: List[CodeSmell]):
        if node.type in ('class_definition', 'class_declaration'):
            methods = []
            attributes = []
            self._analyze_class(node, methods, attributes)

            method_count = len(methods)
            attr_count = len(attributes)

            if method_count > self.max_methods or attr_count > self.max_attributes:
                class_name = self._get_class_name(node)
                start_line, end_line = get_node_lines(node)
                
                score_methods = (method_count - self.max_methods) * 3 if method_count > self.max_methods else 0
                score_attrs = (attr_count - self.max_attributes) * 4 if attr_count > self.max_attributes else 0
                severity_score = min(100, 50 + score_methods + score_attrs)

                smells.append(CodeSmell(
                    smell_type="god_class",
                    severity=Severity.from_score(severity_score),
                    severity_score=severity_score,
                    file_path=file_path,
                    start_line=start_line,
                    end_line=end_line,
                    description=f"类 '{class_name}' 有 {method_count} 个方法和 {attr_count} 个属性，可能是上帝类",
                    code_snippet=self._get_snippet(node, code)
                ))

        for child in node.children:
            self._walk_tree(child, code, file_path, smells)

    def _analyze_class(self, node: Node, methods: list, attributes: list):
        for child in node.children:
            if child.type == 'block':
                for item in child.children:
                    if item.type in ('function_definition', 'method_definition', 
                                     'function_declaration', 'method_definition'):
                        methods.append(item)
                    elif item.type == 'expression_statement':
                        for sub in item.children:
                            if sub.type == 'assignment':
                                attributes.append(sub)
            elif child.type in ('function_definition', 'method_definition'):
                methods.append(child)
            self._analyze_class(child, methods, attributes)

    def _get_class_name(self, node: Node) -> str:
        for child in node.children:
            if child.type == 'identifier':
                return child.text.decode('utf-8', errors='ignore')
        return "anonymous"

    def _get_snippet(self, node: Node, code: str) -> str:
        for child in node.children:
            if child.type == 'identifier':
                return f"class {child.text.decode('utf-8', errors='ignore')} ..."
        return get_node_text(node, code)[:100]


class DuplicateCodeDetector(BaseSmellDetector):
    def __init__(self, min_lines: int = 6, similarity_threshold: float = 0.85):
        self.min_lines = min_lines
        self.similarity_threshold = similarity_threshold

    def detect(self, node: Node, code: str, file_path: str) -> List[CodeSmell]:
        smells = []
        blocks = []
        self._collect_blocks(node, code, blocks)
        self._find_duplicates(blocks, code, file_path, smells)
        return smells

    def _collect_blocks(self, node: Node, code: str, blocks: list, parent: Node = None):
        if node.type in ('function_definition', 'function_declaration', 
                         'method_definition'):
            start_line, end_line = get_node_lines(node)
            line_count = end_line - start_line + 1

            if line_count >= self.min_lines:
                text = get_node_text(node, code)
                normalized = self._normalize_text(text)
                blocks.append({
                    'node': node,
                    'type': node.type,
                    'start_line': start_line,
                    'end_line': end_line,
                    'normalized': normalized,
                    'original': text,
                    'parent': parent
                })

        for child in node.children:
            self._collect_blocks(child, code, blocks, node)

    def _normalize_text(self, text: str) -> str:
        import re
        text = re.sub(r'//.*?$', '', text, flags=re.MULTILINE)
        text = re.sub(r'#.*?$', '', text, flags=re.MULTILINE)
        text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
        text = re.sub(r'\s+', ' ', text)
        return text.strip().lower()

    def _is_nested(self, block1: dict, block2: dict) -> bool:
        """检查两个块是否有嵌套关系"""
        a_start, a_end = block1['start_line'], block1['end_line']
        b_start, b_end = block2['start_line'], block2['end_line']
        
        # 检查一个是否包含另一个
        if (a_start <= b_start and a_end >= b_end) or (b_start <= a_start and b_end >= a_end):
            return True
        return False

    def _find_duplicates(self, blocks: list, code: str, file_path: str, smells: list):
        from difflib import SequenceMatcher

        reported_pairs = set()
        reported_lines = set()

        for i, block1 in enumerate(blocks):
            for j, block2 in enumerate(blocks[i + 1:], i + 1):
                pair_key = (min(i, j), max(i, j))
                if pair_key in reported_pairs:
                    continue

                # 跳过嵌套的代码块（一个是另一个的子节点）
                if self._is_nested(block1, block2):
                    continue

                # 跳过行号太接近的（可能是同一个结构的不同部分）
                if abs(block1['start_line'] - block2['start_line']) < 5:
                    continue

                similarity = SequenceMatcher(None, block1['normalized'], block2['normalized']).ratio()

                if similarity >= self.similarity_threshold:
                    # 检查是否已经报告过其中一个
                    if (block1['start_line'], block1['end_line']) in reported_lines:
                        continue
                    if (block2['start_line'], block2['end_line']) in reported_lines:
                        continue

                    reported_pairs.add(pair_key)
                    reported_lines.add((block1['start_line'], block1['end_line']))
                    reported_lines.add((block2['start_line'], block2['end_line']))
                    
                    severity_score = int(similarity * 100)

                    smells.append(CodeSmell(
                        smell_type="duplicate_code",
                        severity=Severity.from_score(severity_score),
                        severity_score=severity_score,
                        file_path=file_path,
                        start_line=block1['start_line'],
                        end_line=block1['end_line'],
                        description=f"与第 {block2['start_line']}-{block2['end_line']} 行代码重复 (相似度: {similarity:.1%})",
                        code_snippet=block1['original'][:200] + '...' if len(block1['original']) > 200 else block1['original']
                    ))
