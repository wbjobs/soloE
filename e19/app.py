import os
import hashlib
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from langchain.vectorstores import Chroma
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.chains import RetrievalQA
from langchain.chat_models import ChatOpenAI
from langchain.prompts import PromptTemplate

from utils import load_documents, split_code


app = FastAPI(title="Code QA API", description="Ask questions about your Go codebase")


class AskRequest(BaseModel):
    question: str
    repo_path: str
    k: int = 8
    model: str = "gpt-3.5-turbo"
    db_path: Optional[str] = None
    force_reindex: bool = False


class AskResponse(BaseModel):
    answer: str
    sources: list[str]
    chunks_retrieved: int


PROMPT_TEMPLATE = """你是一个代码分析专家。请基于以下多个代码片段回答用户的问题。

相关代码片段：
{context}

用户问题：{question}

请用中文回答，分析代码并给出详细的解释。需要时引用具体的代码片段和文件路径。如果代码中没有相关信息，请诚实说明。"""


def get_db_path(repo_path: str, custom_db_path: Optional[str] = None) -> str:
    if custom_db_path:
        return custom_db_path
    repo_hash = hashlib.md5(repo_path.encode()).hexdigest()[:8]
    return f"./chroma_dbs/{repo_hash}"


def ingest_if_needed(repo_path: str, db_path: str, force_reindex: bool = False):
    if not os.path.exists(repo_path):
        raise HTTPException(status_code=400, detail=f"Repository path does not exist: {repo_path}")
    
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    
    db_exists = os.path.exists(db_path) and len(os.listdir(db_path)) > 0
    
    if not db_exists or force_reindex:
        print(f"Indexing {repo_path} into {db_path}...")
        documents = load_documents(repo_path)
        splits = split_code(documents)
        
        embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2"
        )
        
        vectordb = Chroma.from_documents(
            documents=splits,
            embedding=embeddings,
            persist_directory=db_path
        )
        vectordb.persist()
        print(f"Indexed {len(splits)} code chunks")
    else:
        print(f"Using existing index at {db_path}")


@app.post("/ask", response_model=AskResponse)
async def ask_question(request: AskRequest):
    if 'OPENAI_API_KEY' not in os.environ:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY environment variable is not set")
    
    try:
        db_path = get_db_path(request.repo_path, request.db_path)
        
        ingest_if_needed(request.repo_path, db_path, request.force_reindex)
        
        embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2"
        )
        
        vectordb = Chroma(
            persist_directory=db_path,
            embedding_function=embeddings
        )
        
        llm = ChatOpenAI(
            model_name=request.model,
            temperature=0
        )
        
        retriever = vectordb.as_retriever(search_kwargs={"k": request.k})
        
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
        
        result = qa_chain({"query": request.question})
        
        sources = list(set(doc.metadata["source"] for doc in result["source_documents"]))
        
        return AskResponse(
            answer=result["result"],
            sources=sources,
            chunks_retrieved=len(result["source_documents"])
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
