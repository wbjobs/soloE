import argparse
import os
from langchain.vectorstores import Chroma
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.chains import RetrievalQA
from langchain.chat_models import ChatOpenAI
from langchain.prompts import PromptTemplate


PROMPT_TEMPLATE = """你是一个代码分析专家。请基于以下多个代码片段回答用户的问题。

相关代码片段：
{context}

用户问题：{question}

请用中文回答，分析代码并给出详细的解释。需要时引用具体的代码片段和文件路径。如果代码中没有相关信息，请诚实说明。"""


def main():
    parser = argparse.ArgumentParser(description='Query the codebase')
    parser.add_argument('--question', required=True, help='Question to ask about the codebase')
    parser.add_argument('--db-path', default='./chroma_db', help='Path to ChromaDB')
    parser.add_argument('--k', type=int, default=8, help='Number of relevant code chunks to retrieve')
    parser.add_argument('--score-threshold', type=float, default=0.0, help='Minimum similarity score threshold')
    parser.add_argument('--model', default='gpt-3.5-turbo', help='OpenAI model to use')
    parser.add_argument('--show-context', action='store_true', help='Show retrieved context')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.db_path):
        print(f"Error: Vector database not found at {args.db_path}")
        print("Please run ingest.py first to create the database")
        return
    
    if 'OPENAI_API_KEY' not in os.environ:
        print("Error: OPENAI_API_KEY environment variable is not set")
        return
    
    print("Loading vector database...")
    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )
    
    vectordb = Chroma(
        persist_directory=args.db_path,
        embedding_function=embeddings
    )
    
    print(f"Initializing LLM ({args.model})...")
    llm = ChatOpenAI(
        model_name=args.model,
        temperature=0
    )
    
    print(f"\n{'='*80}")
    print(f"Question: {args.question}")
    print('='*80 + "\n")
    
    print(f"Retrieving top {args.k} relevant code chunks...")
    
    search_kwargs = {"k": args.k}
    if args.score_threshold > 0:
        search_kwargs["score_threshold"] = args.score_threshold
    
    retriever = vectordb.as_retriever(search_kwargs=search_kwargs)
    
    docs = retriever.get_relevant_documents(args.question)
    
    print(f"Retrieved {len(docs)} relevant code chunks from {len(set(d.metadata['source'] for d in docs))} files:\n")
    
    for i, doc in enumerate(docs, 1):
        print(f"--- [{i}] {doc.metadata['source']} ---")
        if args.show_context:
            print(doc.page_content[:300] + "..." if len(doc.page_content) > 300 else doc.page_content)
            print()
    
    if not docs:
        print("No relevant code chunks found.")
        return
    
    PROMPT = PromptTemplate(
        template=PROMPT_TEMPLATE,
        input_variables=["context", "question"]
    )
    
    chain_type_kwargs = {"prompt": PROMPT}
    
    qa_chain = RetrievalQA.from_chain_type(
        llm=llm,
        chain_type="stuff",
        retriever=retriever,
        return_source_documents=True,
        chain_type_kwargs=chain_type_kwargs
    )
    
    print("\n" + "="*80)
    print("Generating answer...")
    print("="*80 + "\n")
    
    result = qa_chain({"query": args.question})
    
    print("Answer:")
    print(result["result"])
    print()
    
    print("="*80)
    print("Source Files:")
    print("="*80)
    sources = {}
    for doc in result["source_documents"]:
        src = doc.metadata["source"]
        if src not in sources:
            sources[src] = 0
        sources[src] += 1
    
    for source, count in sorted(sources.items(), key=lambda x: -x[1]):
        print(f"- {source} ({count} chunks)")


if __name__ == "__main__":
    main()
