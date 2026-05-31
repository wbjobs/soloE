import argparse
import os
from langchain.vectorstores import Chroma
from langchain.embeddings import HuggingFaceEmbeddings
from utils import load_documents, split_code


def main():
    parser = argparse.ArgumentParser(description='Ingest Go code into vector database')
    parser.add_argument('--dir', required=True, help='Directory containing Go files')
    parser.add_argument('--db-path', default='./chroma_db', help='Path to store ChromaDB')
    parser.add_argument('--chunk-size', type=int, default=1000, help='Chunk size for code splitting')
    parser.add_argument('--chunk-overlap', type=int, default=200, help='Chunk overlap for code splitting')
    
    args = parser.parse_args()
    
    if not os.path.isdir(args.dir):
        print(f"Error: Directory '{args.dir}' does not exist")
        return
    
    print(f"Scanning Go files in {args.dir}...")
    documents = load_documents(args.dir)
    print(f"Found {len(documents)} Go files")
    
    print(f"Splitting code into chunks (size={args.chunk_size}, overlap={args.chunk_overlap})...")
    splits = split_code(documents, args.chunk_size, args.chunk_overlap)
    print(f"Generated {len(splits)} code chunks")
    
    print("Initializing embedding model (sentence-transformers/all-MiniLM-L6-v2)...")
    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )
    
    print(f"Creating vector database at {args.db_path}...")
    vectordb = Chroma.from_documents(
        documents=splits,
        embedding=embeddings,
        persist_directory=args.db_path
    )
    
    vectordb.persist()
    print("Done! Vector database created and persisted successfully")
    print(f"Total vectors stored: {vectordb._collection.count()}")


if __name__ == "__main__":
    main()
