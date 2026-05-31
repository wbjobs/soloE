#!/usr/bin/env python3
import argparse
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import Chroma
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from langchain.prompts import PromptTemplate

load_dotenv()

QA_PROMPT = """
你是一个专业的文档问答助手。请基于以下提供的上下文信息来回答用户的问题。
如果你不知道答案，请明确说"根据提供的文档内容，我无法回答这个问题"，不要编造答案。

上下文信息（每个文档块都标有来源文件）:
{context}

用户问题: {question}

回答:
"""


def format_documents(docs):
    formatted_docs = []
    for i, doc in enumerate(docs, 1):
        source = doc.metadata.get('source', 'Unknown')
        chunk_index = doc.metadata.get('chunk_index', 'N/A')
        formatted_docs.append(
            f"[文档 {i}] 来源：{source} (第{chunk_index}块)\n内容：{doc.page_content}"
        )
    return "\n\n".join(formatted_docs)


def load_vector_store(persist_directory="./db"):
    embeddings = OpenAIEmbeddings()
    vector_store = Chroma(
        persist_directory=persist_directory,
        embedding_function=embeddings
    )
    return vector_store


def setup_qa_chain(vector_store, k=4, model_name="gpt-3.5-turbo"):
    llm = ChatOpenAI(model_name=model_name, temperature=0)
    
    prompt = PromptTemplate(
        template=QA_PROMPT,
        input_variables=["context", "question"]
    )
    
    retriever = vector_store.as_retriever(search_kwargs={"k": k})
    
    rag_chain = (
        {"context": retriever | format_documents, "question": RunnablePassthrough()}
        | prompt
        | llm
        | StrOutputParser()
    )
    
    return rag_chain, retriever


def extract_unique_sources(source_documents):
    sources = set()
    for doc in source_documents:
        source = doc.metadata.get('source', 'Unknown')
        chunk_index = doc.metadata.get('chunk_index', 'N/A')
        sources.add(f"{source} (第{chunk_index}块)")
    return sorted(list(sources))


def answer_question(qa_chain, retriever, question, show_sources=False):
    source_docs = retriever.get_relevant_documents(question)
    
    answer = qa_chain.invoke(question)
    
    print("\n" + "="*80)
    print("回答:")
    print("="*80)
    print(answer)
    
    sources = extract_unique_sources(source_docs)
    print(f"\n引用来源：{', '.join(sources)}")
    print("="*80)
    
    if show_sources:
        print("\n" + "="*80)
        print("详细参考来源:")
        print("="*80)
        for i, doc in enumerate(source_docs, 1):
            source = doc.metadata.get('source', 'Unknown')
            chunk_index = doc.metadata.get('chunk_index', 'N/A')
            print(f"\n[{i}] {source} (第{chunk_index}块)")
            print(f"内容片段:\n{doc.page_content[:300]}...")
        print("="*80)


def interactive_mode(qa_chain, retriever, show_sources=False):
    print("\n" + "="*80)
    print("Markdown 文档问答系统 - 交互模式")
    print("="*80)
    print("输入 'quit' 或 'exit' 退出程序\n")
    
    while True:
        question = input("请输入问题: ").strip()
        
        if question.lower() in ['quit', 'exit', 'q']:
            print("再见!")
            break
        
        if not question:
            continue
        
        answer_question(qa_chain, retriever, question, show_sources)


def main():
    parser = argparse.ArgumentParser(description="Query Markdown documents using RAG")
    parser.add_argument(
        "--persist-dir", 
        "-p", 
        default="./db", 
        help="Directory where vector store is persisted"
    )
    parser.add_argument(
        "--k", 
        type=int, 
        default=4, 
        help="Number of similar chunks to retrieve"
    )
    parser.add_argument(
        "--model", 
        "-m", 
        default="gpt-3.5-turbo", 
        help="LLM model name to use"
    )
    parser.add_argument(
        "--question", 
        "-q", 
        help="Single question to answer (exits after answering)"
    )
    parser.add_argument(
        "--show-sources", 
        "-s", 
        action="store_true", 
        help="Show source documents"
    )
    parser.add_argument(
        "--interactive", 
        "-i", 
        action="store_true", 
        help="Run in interactive mode"
    )
    
    args = parser.parse_args()
    
    print(f"Loading vector store from: {args.persist_dir}")
    vector_store = load_vector_store(args.persist_dir)
    
    print(f"Setting up QA chain with model: {args.model}")
    qa_chain, retriever = setup_qa_chain(vector_store, k=args.k, model_name=args.model)
    
    if args.question:
        answer_question(qa_chain, retriever, args.question, args.show_sources)
    elif args.interactive:
        interactive_mode(qa_chain, retriever, args.show_sources)
    else:
        parser.print_help()
        print("\nExample usage:")
        print("  python query.py -i                    # Interactive mode")
        print("  python query.py -q \"你的问题\" -s      # Single question with sources")


if __name__ == "__main__":
    main()
