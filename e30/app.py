#!/usr/bin/env python3
import os
import tempfile
import streamlit as st
from dotenv import load_dotenv
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
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

PERSIST_DIR = "./db"
DOCS_DIR = "./docs"

os.makedirs(PERSIST_DIR, exist_ok=True)
os.makedirs(DOCS_DIR, exist_ok=True)


def format_documents(docs):
    formatted_docs = []
    for i, doc in enumerate(docs, 1):
        source = doc.metadata.get('source', 'Unknown')
        chunk_index = doc.metadata.get('chunk_index', 'N/A')
        formatted_docs.append(
            f"[文档 {i}] 来源：{source} (第{chunk_index}块)\n内容：{doc.page_content}"
        )
    return "\n\n".join(formatted_docs)


def load_markdown_files(directory_path):
    from glob import glob
    markdown_files = glob(os.path.join(directory_path, "**/*.md"), recursive=True)
    documents = []
    
    for file_path in markdown_files:
        try:
            loader = TextLoader(file_path, encoding='utf-8')
            docs = loader.load()
            for doc in docs:
                doc.metadata['source'] = os.path.relpath(file_path, directory_path)
            documents.extend(docs)
        except Exception as e:
            st.error(f"加载文件 {file_path} 时出错: {e}")
    
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


def create_vector_store(chunks, persist_directory=PERSIST_DIR):
    embeddings = OpenAIEmbeddings()
    
    vector_store = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=persist_directory
    )
    
    vector_store.persist()
    return vector_store


def load_vector_store(persist_directory=PERSIST_DIR):
    if not os.path.exists(os.path.join(persist_directory, "chroma-embeddings.parquet")):
        return None
    try:
        embeddings = OpenAIEmbeddings()
        vector_store = Chroma(
            persist_directory=persist_directory,
            embedding_function=embeddings
        )
        return vector_store
    except Exception as e:
        return None


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


def save_uploaded_file(uploaded_file):
    file_path = os.path.join(DOCS_DIR, uploaded_file.name)
    with open(file_path, "wb") as f:
        f.write(uploaded_file.getbuffer())
    return file_path


def reindex_documents():
    with st.spinner("正在重新索引文档..."):
        documents = load_markdown_files(DOCS_DIR)
        if not documents:
            st.warning("没有找到任何 Markdown 文档")
            return False
        
        chunks = split_documents(documents)
        create_vector_store(chunks)
        return True


def main():
    st.set_page_config(
        page_title="Markdown 文档问答系统",
        page_icon="📚",
        layout="wide"
    )

    st.title("📚 Markdown 文档问答系统")
    
    if "messages" not in st.session_state:
        st.session_state.messages = []
    
    if "vector_store" not in st.session_state:
        st.session_state.vector_store = load_vector_store()
    
    if "qa_chain" not in st.session_state:
        st.session_state.qa_chain = None
        st.session_state.retriever = None
    
    with st.sidebar:
        st.header("📁 文档管理")
        
        uploaded_files = st.file_uploader(
            "上传 Markdown 文档",
            type=["md"],
            accept_multiple_files=True,
            help="支持上传多个 .md 文件"
        )
        
        if uploaded_files:
            for uploaded_file in uploaded_files:
                file_path = save_uploaded_file(uploaded_file)
                st.success(f"✅ 已上传: {uploaded_file.name}")
            
            if st.button("🔄 重新索引文档", type="primary"):
                if reindex_documents():
                    st.session_state.vector_store = load_vector_store()
                    if st.session_state.vector_store:
                        st.session_state.qa_chain, st.session_state.retriever = setup_qa_chain(
                            st.session_state.vector_store
                        )
                    st.success("✅ 索引完成！")
                    st.rerun()
        
        st.divider()
        
        st.subheader("📋 已索引文档")
        if os.path.exists(DOCS_DIR):
            doc_files = [f for f in os.listdir(DOCS_DIR) if f.endswith('.md')]
            if doc_files:
                for doc in doc_files:
                    st.text(f"• {doc}")
            else:
                st.info("暂无文档，请上传 Markdown 文件")
        
        st.divider()
        
        with st.expander("⚙️ 设置"):
            st.selectbox("GPT 模型", ["gpt-3.5-turbo", "gpt-4"], key="model_name")
            st.slider("检索文档数", 1, 8, 4, key="k_value")
            st.checkbox("显示详细来源", value=True, key="show_sources")
        
        if st.button("🧹 清空对话"):
            st.session_state.messages = []
            st.rerun()

    col1, col2 = st.columns([3, 1])
    
    with col2:
        if st.session_state.vector_store:
            st.info(f"✅ 系统就绪，已索引 {len([f for f in os.listdir(DOCS_DIR) if f.endswith('.md')])} 个文档")
        else:
            st.warning("⚠️ 请先上传文档并建立索引")
    
    st.divider()

    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])
            if "sources" in message and message["sources"]:
                with st.expander("📑 引用来源"):
                    for i, source in enumerate(message["sources"], 1):
                        st.markdown(f"{i}. {source}")

    if prompt := st.chat_input("请输入您的问题..."):
        if not st.session_state.vector_store:
            st.error("请先上传文档并建立索引！")
        else:
            if not st.session_state.qa_chain:
                st.session_state.qa_chain, st.session_state.retriever = setup_qa_chain(
                    st.session_state.vector_store,
                    k=st.session_state.k_value,
                    model_name=st.session_state.model_name
                )
            
            st.session_state.messages.append({"role": "user", "content": prompt})
            
            with st.chat_message("user"):
                st.markdown(prompt)
            
            with st.chat_message("assistant"):
                with st.spinner("正在思考..."):
                    source_docs = st.session_state.retriever.get_relevant_documents(prompt)
                    answer = st.session_state.qa_chain.invoke(prompt)
                    sources = extract_unique_sources(source_docs)
                    
                    st.markdown(answer)
                    
                    if st.session_state.show_sources and sources:
                        with st.expander("📑 引用来源"):
                            for i, source in enumerate(sources, 1):
                                st.markdown(f"{i}. {source}")
            
            st.session_state.messages.append({
                "role": "assistant",
                "content": answer,
                "sources": sources
            })


if __name__ == "__main__":
    main()
