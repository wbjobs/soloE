import os
import re
from typing import List
from langchain.schema import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter, Language


def scan_go_files(directory: str) -> List[str]:
    go_files = []
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith('.go'):
                go_files.append(os.path.join(root, file))
    return go_files


def read_file(file_path: str) -> str:
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        with open(file_path, 'r', encoding='latin-1') as f:
            return f.read()


def enhance_metadata(doc: Document) -> Document:
    content = doc.page_content
    
    package_match = re.search(r'^package\s+(\w+)', content, re.MULTILINE)
    if package_match:
        doc.metadata['package'] = package_match.group(1)
    
    func_matches = re.findall(r'^func\s+(\w+)', content, re.MULTILINE)
    if func_matches:
        doc.metadata['functions'] = ', '.join(func_matches[:5])
    
    type_matches = re.findall(r'^type\s+(\w+)\s+', content, re.MULTILINE)
    if type_matches:
        doc.metadata['types'] = ', '.join(type_matches[:5])
    
    return doc


def split_code(documents: List[Document], chunk_size: int = 800, chunk_overlap: int = 150) -> List[Document]:
    go_separators = [
        "\nfunc ",
        "\ntype ",
        "\nconst ",
        "\nvar ",
        "\n\n",
        "\n",
        " ",
        "",
    ]
    
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=go_separators
    )
    
    splits = text_splitter.split_documents(documents)
    
    enhanced_splits = []
    for split in splits:
        enhanced = enhance_metadata(split)
        enhanced_splits.append(enhanced)
    
    return enhanced_splits


def load_documents(directory: str) -> List[Document]:
    go_files = scan_go_files(directory)
    documents = []
    for file_path in go_files:
        content = read_file(file_path)
        rel_path = os.path.relpath(file_path, directory)
        doc = Document(
            page_content=content,
            metadata={"source": rel_path, "file_path": file_path}
        )
        documents.append(doc)
    return documents
