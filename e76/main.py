from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import io
from model import get_model, MockGNNModel
from molecule_utils import validate_smiles
from tasks import submit_batch_task, submit_csv_task, get_task_status_universal, USE_CELERY
from faiss_index import search_similar_molecules, get_similarity_index, MoleculeSimilarityIndex


app = FastAPI(
    title="Molecular LogP Prediction API",
    description="A service for predicting molecular logP solubility using a pre-trained GNN model with async batch processing",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    smiles: str


class PredictResponse(BaseModel):
    smiles: str
    logp: float
    solubility_class: str
    valid: bool


class BatchPredictRequest(BaseModel):
    smiles_list: List[str]


class TaskSubmitResponse(BaseModel):
    task_id: str
    message: str


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    state: str
    message: Optional[str] = None
    current: Optional[int] = None
    total: Optional[int] = None
    progress: Optional[int] = None
    total_count: Optional[int] = None
    success_count: Optional[int] = None
    results: Optional[List[PredictResponse]] = None
    error: Optional[str] = None


class SimilarMoleculeRequest(BaseModel):
    smiles: str
    top_k: Optional[int] = 5


class SimilarMoleculeResponse(BaseModel):
    rank: int
    smiles: str
    name: str
    logp: float
    similarity: float
    solubility_class: str


class SimilarSearchResponse(BaseModel):
    query_smiles: str
    results: List[SimilarMoleculeResponse]
    library_size: int
    backend: str


model: Optional[MockGNNModel] = None
similarity_index: Optional[MoleculeSimilarityIndex] = None


@app.on_event("startup")
async def startup_event():
    global model, similarity_index
    model = get_model()
    print(f"[FastAPI] Model loaded: {model.is_loaded}, device: {model.device}")

    similarity_index = get_similarity_index()
    print(f"[FastAPI] Similarity index built: {similarity_index.is_built()}, size: {similarity_index.get_index_size()}")


@app.get("/")
async def root():
    return {
        "message": "Molecular LogP Prediction API v2.1",
        "version": "2.1.0",
        "model_loaded": model.is_loaded if model else False,
        "similarity_index_built": similarity_index.is_built() if similarity_index else False,
        "library_size": similarity_index.get_index_size() if similarity_index else 0,
        "features": [
            "Single molecule prediction",
            "Async batch prediction with Celery",
            "CSV upload with async processing",
            "Task status polling",
            "CSV result download",
            "Similar molecule search with FAISS"
        ],
        "endpoints": {
            "predict": "POST /api/v1/predict",
            "predict_batch_async": "POST /api/v1/predict/batch/async",
            "upload_csv_async": "POST /api/v1/predict/upload/async",
            "task_status": "GET /api/v1/tasks/{task_id}",
            "download_result": "GET /api/v1/tasks/{task_id}/download",
            "similar_search": "POST /api/v1/similar/search",
            "similar_search_get": "GET /api/v1/similar/search",
            "library_info": "GET /api/v1/similar/library",
            "health": "/health"
        }
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model_loaded": model.is_loaded if model else False,
        "model_device": model.device if model else None
    }


@app.post("/api/v1/predict", response_model=PredictResponse)
async def predict(request: PredictRequest):
    if not model or not model.is_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")

    smiles = request.smiles.strip()
    valid = validate_smiles(smiles)

    if not valid:
        return PredictResponse(
            smiles=smiles,
            logp=0.0,
            solubility_class="Invalid",
            valid=False
        )

    logp = model.predict(smiles)
    solubility_class = model._classify_logp(logp)

    return PredictResponse(
        smiles=smiles,
        logp=logp,
        solubility_class=solubility_class,
        valid=True
    )


@app.post("/api/v1/predict/batch/async", response_model=TaskSubmitResponse)
async def predict_batch_async(request: BatchPredictRequest):
    if not model or not model.is_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")

    if len(request.smiles_list) == 0:
        raise HTTPException(status_code=400, detail="SMILES list cannot be empty")

    task_id = submit_batch_task(request.smiles_list)

    return TaskSubmitResponse(
        task_id=task_id,
        message=f"Batch prediction task submitted with {len(request.smiles_list)} molecules (backend: {'celery' if USE_CELERY else 'in-memory'})"
    )


@app.post("/api/v1/predict/upload/async", response_model=TaskSubmitResponse)
async def upload_csv_async(file: UploadFile = File(...)):
    if not model or not model.is_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")

    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")

    try:
        contents = await file.read()
        csv_text = contents.decode('utf-8')

        task_id = submit_csv_task(csv_text)

        return TaskSubmitResponse(
            task_id=task_id,
            message=f"CSV upload task submitted successfully (backend: {'celery' if USE_CELERY else 'in-memory'})"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing CSV: {str(e)}")


@app.get("/api/v1/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status_endpoint(task_id: str):
    try:
        status = get_task_status_universal(task_id)

        if status["status"] == "completed" and "results" in status:
            results = []
            for r in status["results"]:
                results.append(PredictResponse(
                    smiles=r["smiles"],
                    logp=r["logp"],
                    solubility_class=r["solubility_class"],
                    valid=r["valid"]
                ))
            status["results"] = results

        return TaskStatusResponse(**status)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting task status: {str(e)}")


@app.get("/api/v1/tasks/{task_id}/download")
async def download_task_result(task_id: str):
    try:
        status = get_task_status_universal(task_id)

        if status["status"] != "completed":
            raise HTTPException(status_code=400, detail="Task not completed yet")

        csv_data = status.get("csv_data", "")
        if not csv_data:
            raise HTTPException(status_code=404, detail="No CSV data available")

        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=logp_predictions_{task_id}.csv"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error downloading result: {str(e)}")


@app.get("/api/v1/similar/library")
async def get_library_info():
    try:
        from molecule_library import get_library, get_library_size
        library = get_library()
        return {
            "total_molecules": get_library_size(),
            "molecules": library
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting library info: {str(e)}")


@app.post("/api/v1/similar/search", response_model=SimilarSearchResponse)
async def search_similar(request: SimilarMoleculeRequest):
    if not similarity_index or not similarity_index.is_built():
        raise HTTPException(status_code=503, detail="Similarity index not built")

    smiles = request.smiles.strip()
    top_k = request.top_k if request.top_k and 1 <= request.top_k <= 50 else 5

    valid = validate_smiles(smiles)
    if not valid:
        raise HTTPException(status_code=400, detail="Invalid SMILES string")

    try:
        results = search_similar_molecules(smiles, top_k=top_k)

        similar_molecules = []
        for r in results:
            similar_molecules.append(SimilarMoleculeResponse(
                rank=r["rank"],
                smiles=r["smiles"],
                name=r["name"],
                logp=r["logp"],
                similarity=r["similarity"],
                solubility_class=r["solubility_class"]
            ))

        return SimilarSearchResponse(
            query_smiles=smiles,
            results=similar_molecules,
            library_size=similarity_index.get_index_size(),
            backend="faiss" if similarity_index._index is not None else "numpy"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error searching similar molecules: {str(e)}")


@app.get("/api/v1/similar/search")
async def search_similar_get(smiles: str, top_k: int = 5):
    if not similarity_index or not similarity_index.is_built():
        raise HTTPException(status_code=503, detail="Similarity index not built")

    smiles = smiles.strip()
    top_k = top_k if 1 <= top_k <= 50 else 5

    valid = validate_smiles(smiles)
    if not valid:
        raise HTTPException(status_code=400, detail="Invalid SMILES string")

    try:
        results = search_similar_molecules(smiles, top_k=top_k)

        similar_molecules = []
        for r in results:
            similar_molecules.append({
                "rank": r["rank"],
                "smiles": r["smiles"],
                "name": r["name"],
                "logp": r["logp"],
                "similarity": r["similarity"],
                "solubility_class": r["solubility_class"]
            })

        return {
            "query_smiles": smiles,
            "results": similar_molecules,
            "library_size": similarity_index.get_index_size(),
            "backend": "faiss" if hasattr(similarity_index, '_index') and similarity_index._index is not None else "numpy"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error searching similar molecules: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
