#!/usr/bin/env python3
import os
import glob
import argparse
from dotenv import load_dotenv
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma

load_dotenv()


def load_markdown_files(directory_path):
    markdown_files = glob.glob(os.path.join(directory_path, "**/*.md"), recursive=True)
    documents = []
    
    for file_path in markdown_files:
        try:
            loader = TextLoader(file_path, encoding='utf-8')
            docs = loader.load()
            for doc in docs:
                doc.metadata['source'] = os.path.relpath(file_path, directory_path)
            documents.extend(docs)
            print(f"Loaded: {os.path.relpath(file_path, directory_path)}")
        except Exception as e:
            print(f"Error loading {file_path}: {e}")
    
    return documents


def split_documents(documents, chunk_size=1000, chunk_overlap=200):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=["\n\n", "\n", " ", ""]
    )
    chunks = text_splitter.split_documents(documents)
    
    source_chunk_counts = {}
    for chunk in chunks:
        source = chunk.metadata.get('source', 'unknown')
        if source not in source_chunk_counts:
            source_chunk_counts[source] = 0
        source_chunk_counts[source] += 1
        chunk.metadata['chunk_index'] = source_chunk_counts[source]
    
    return chunks


def create_vector_store(chunks, persist_directory="./db"):
    embeddings = OpenAIEmbeddings()
    
    vector_store = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=persist_directory
    )
    
    vector_store.persist()
    return vector_store


def main():
    parser = argparse.ArgumentParser(description="Index Markdown documents into vector store")
    parser.add_argument(
        "--directory", 
        "-d", 
        required=True, 
        help="Directory containing Markdown files"
    )
    parser.add_argument(
        "--persist-dir", 
        "-p", 
        default="./db", 
        help="Directory to persist the vector store"
    )
    parser.add_argument(
        "--chunk-size", 
        type=int, 
        default=1000, 
        help="Chunk size for text splitting"
    )
    parser.add_argument(
        "--chunk-overlap", 
        type=int, 
        default=200, 
        help="Chunk overlap for text splitting"
    )
    
    args = parser.parse_args()
    
    if not os.path.isdir(args.directory):
        print(f"Error: Directory '{args.directory}' does not exist")
        return
    
    print(f"\nLoading Markdown files from: {args.directory}")
    documents = load_markdown_files(args.directory)
    
    if not documents:
        print("No Markdown files found")
        return
    
    print(f"\nTotal documents loaded: {len(documents)}")
    
    print(f"\nSplitting documents into chunks (size={args.chunk_size}, overlap={args.chunk_overlap})")
    chunks = split_documents(documents, args.chunk_size, args.chunk_overlap)
    print(f"Total chunks created: {len(chunks)}")
    
    print(f"\nCreating vector store and embedding chunks...")
    vector_store = create_vector_store(chunks, args.persist_dir)
    
    print(f"\nDone! Vector store persisted to: {args.persist_dir}")


if __name__ == "__main__":
    main()
