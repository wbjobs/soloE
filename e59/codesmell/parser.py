from pathlib import Path
from typing import Optional, Tuple
from tree_sitter import Language, Parser, Node
import tree_sitter_python
import tree_sitter_javascript


class CodeParser:
    def __init__(self):
        self.python_lang = Language(tree_sitter_python.language())
        self.javascript_lang = Language(tree_sitter_javascript.language())
        self.python_parser = Parser(self.python_lang)
        self.javascript_parser = Parser(self.javascript_lang)

    def parse_file(self, file_path: str) -> Tuple[Optional[Node], Optional[str]]:
        path = Path(file_path)
        if not path.exists():
            return None, None

        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            code = f.read()

        return self.parse_code(code, path.suffix), code

    def parse_code(self, code: str, extension: str) -> Optional[Node]:
        if extension in ('.py'):
            return self.python_parser.parse(bytes(code, 'utf-8')).root_node
        elif extension in ('.js', '.jsx', '.ts', '.tsx'):
            return self.javascript_parser.parse(bytes(code, 'utf-8')).root_node
        return None

    def get_language(self, extension: str) -> Optional[Language]:
        if extension in ('.py'):
            return self.python_lang
        elif extension in ('.js', '.jsx', '.ts', '.tsx'):
            return self.javascript_lang
        return None


def get_node_text(node: Node, code: str) -> str:
    return code[node.start_byte:node.end_byte]


def get_node_lines(node: Node) -> Tuple[int, int]:
    return node.start_point[0] + 1, node.end_point[0] + 1
