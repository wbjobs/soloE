from fastapi import APIRouter, HTTPException
from typing import Dict, Any

from ..models.schemas import QueryRequest, QueryResponse
from ..agent.query_agent import process_question, explain_question
from ..cache.query_cache import get_cache

router = APIRouter(prefix="/api/v1", tags=["query"])


@router.post("/query", response_model=QueryResponse)
async def execute_query(request: QueryRequest) -> QueryResponse:
    if not request.question or not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    try:
        response, from_cache = process_question(
            request.question,
            timeout_ms=request.timeout_ms,
            bypass_cache=request.bypass_cache,
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query execution failed: {str(e)}")


@router.post("/explain")
async def explain_query(request: QueryRequest) -> Dict[str, Any]:
    if not request.question or not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    try:
        explanation = explain_question(request.question, timeout_ms=request.timeout_ms)
        return explanation
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query explanation failed: {str(e)}")


@router.get("/cache/stats")
async def get_cache_stats() -> Dict[str, Any]:
    cache = get_cache()
    return cache.stats()


@router.post("/cache/clear")
async def clear_cache() -> Dict[str, Any]:
    cache = get_cache()
    cache.clear()
    return {"status": "success", "message": "Cache cleared successfully"}


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    return {"status": "healthy", "service": "Federated Query API Gateway"}
