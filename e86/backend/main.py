"""FastAPI backend for data lineage visualization."""

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from typing import Dict, List, Optional, Any, Set
from datetime import datetime
import uuid
import json
import csv
import io
from fastapi.responses import StreamingResponse

app = FastAPI(title="Parquet Data Lineage Service")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

lineage_store: Dict[str, Dict[str, Any]] = {}


class LineageUploadResponse(BaseModel):
    id: str
    message: str
    created_at: str


class ImpactAnalysisRequest(BaseModel):
    column: str
    max_depth: int = 10


class ImpactAnalysisResponse(BaseModel):
    source_column: str
    total_affected: int
    affected_columns: List[str]
    affected_node_ids: List[str]
    affected_edge_ids: List[str]
    impact_path: List[Dict[str, Any]]


@app.get("/")
async def root():
    return {"message": "Parquet Data Lineage Service", "version": "0.1.0"}


@app.post("/api/lineage", response_model=LineageUploadResponse)
async def upload_lineage(lineage_data: Dict[str, Any]):
    lineage_id = str(uuid.uuid4())[:8]
    stored_data = {
        "id": lineage_id,
        "data": lineage_data,
        "created_at": datetime.utcnow().isoformat(),
        "name": lineage_data.get("name", f"lineage_{lineage_id}")
    }
    lineage_store[lineage_id] = stored_data
    return LineageUploadResponse(
        id=lineage_id,
        message="Lineage data uploaded successfully",
        created_at=stored_data["created_at"]
    )


@app.get("/api/lineage")
async def list_lineage():
    result = []
    for lid, data in lineage_store.items():
        result.append({
            "id": lid,
            "name": data.get("name", lid),
            "created_at": data.get("created_at"),
            "node_count": len(data["data"].get("nodes", [])),
            "edge_count": len(data["data"].get("edges", []))
        })
    return result


@app.get("/api/lineage/{lineage_id}")
async def get_lineage(lineage_id: str):
    if lineage_id not in lineage_store:
        raise HTTPException(status_code=404, detail="Lineage not found")
    return lineage_store[lineage_id]["data"]


@app.delete("/api/lineage/{lineage_id}")
async def delete_lineage(lineage_id: str):
    if lineage_id not in lineage_store:
        raise HTTPException(status_code=404, detail="Lineage not found")
    del lineage_store[lineage_id]
    return {"message": "Lineage deleted successfully"}


@app.get("/api/lineage/{lineage_id}/export/{format}")
async def export_lineage(lineage_id: str, format: str):
    if lineage_id not in lineage_store:
        raise HTTPException(status_code=404, detail="Lineage not found")

    lineage_data = lineage_store[lineage_id]["data"]

    if format == "json":
        return JSONResponse(
            content=lineage_data,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=lineage_{lineage_id}.json"}
        )
    elif format == "csv":
        edges = lineage_data.get("edges", [])
        nodes = {n["id"]: n for n in lineage_data.get("nodes", [])}

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["source", "target", "transformation", "is_direct", "source_type", "target_type"])

        for edge in edges:
            source_node = nodes.get(edge["source"], {})
            target_node = nodes.get(edge["target"], {})
            writer.writerow([
                edge["source"],
                edge["target"],
                edge.get("transformation", ""),
                str(edge.get("is_direct", False)),
                source_node.get("type", ""),
                target_node.get("type", "")
            ])

        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=lineage_{lineage_id}.csv"}
        )
    else:
        raise HTTPException(status_code=400, detail="Invalid format. Use 'json' or 'csv'")


@app.get("/lineage/{lineage_id}", response_class=HTMLResponse)
async def view_lineage(request: Request, lineage_id: str):
    if lineage_id not in lineage_store:
        raise HTTPException(status_code=404, detail="Lineage not found")

    return templates.TemplateResponse(
        "lineage_view.html",
        {"request": request, "lineage_id": lineage_id}
    )


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/lineage/{lineage_id}/search")
async def search_columns(lineage_id: str, q: str):
    """Search for columns by name in the lineage graph."""
    if lineage_id not in lineage_store:
        raise HTTPException(status_code=404, detail="Lineage not found")
    
    lineage_data = lineage_store[lineage_id]["data"]
    nodes = lineage_data.get("nodes", [])
    
    query = q.lower().strip()
    results = []
    
    for node in nodes:
        node_id = node.get("id", "")
        label = node.get("label", "")
        node_type = node.get("type", "")
        
        if query in node_id.lower() or query in label.lower():
            results.append({
                "id": node_id,
                "label": label,
                "type": node_type,
                "metadata": node.get("metadata", {})
            })
    
    return {"query": q, "count": len(results), "results": results}


@app.post("/api/lineage/{lineage_id}/impact", response_model=ImpactAnalysisResponse)
async def analyze_impact(lineage_id: str, request: ImpactAnalysisRequest):
    """Analyze downstream impact of a column change."""
    if lineage_id not in lineage_store:
        raise HTTPException(status_code=404, detail="Lineage not found")
    
    lineage_data = lineage_store[lineage_id]["data"]
    nodes = lineage_data.get("nodes", [])
    edges = lineage_data.get("edges", [])
    
    graph: Dict[str, List[Dict[str, Any]]] = {}
    node_id_map: Dict[str, str] = {}
    
    for node in nodes:
        node_id = node.get("id", "")
        label = node.get("label", "")
        node_id_map[label] = node_id
        node_id_map[node_id] = node_id
        
        if node_id not in graph:
            graph[node_id] = []
    
    for edge in edges:
        source = edge.get("source", "")
        target = edge.get("target", "")
        if source in graph:
            graph[source].append({
                "target": target,
                "transformation": edge.get("transformation", ""),
                "is_direct": edge.get("is_direct", False)
            })
    
    source_column = request.column
    source_node_id = node_id_map.get(source_column, node_id_map.get(f"column:{source_column}"))
    
    if not source_node_id or source_node_id not in graph:
        return ImpactAnalysisResponse(
            source_column=source_column,
            total_affected=0,
            affected_columns=[],
            affected_node_ids=[],
            affected_edge_ids=[],
            impact_path=[]
        )
    
    visited: Set[str] = set()
    affected_node_ids: Set[str] = set()
    affected_edge_ids: Set[str] = set()
    impact_path: List[Dict[str, Any]] = []
    
    def traverse(node_id: str, level: int):
        if level > request.max_depth or node_id in visited:
            return
        
        visited.add(node_id)
        
        if node_id != source_node_id:
            affected_node_ids.add(node_id)
        
        for edge in graph.get(node_id, []):
            target_id = edge["target"]
            edge_id = f"{node_id}->{target_id}"
            
            if target_id not in visited:
                affected_edge_ids.add(edge_id)
                
                node_label = next((n.get("label", target_id) for n in nodes if n.get("id") == target_id), target_id)
                impact_path.append({
                    "column": node_label,
                    "node_id": target_id,
                    "level": level,
                    "transformation": edge["transformation"],
                    "is_direct": edge["is_direct"]
                })
                
                traverse(target_id, level + 1)
    
    traverse(source_node_id, 0)
    
    affected_columns = []
    for node_id in affected_node_ids:
        node = next((n for n in nodes if n.get("id") == node_id), None)
        if node:
            affected_columns.append(node.get("label", node_id))
    
    return ImpactAnalysisResponse(
        source_column=source_column,
        total_affected=len(affected_node_ids),
        affected_columns=sorted(affected_columns),
        affected_node_ids=sorted(affected_node_ids),
        affected_edge_ids=sorted(affected_edge_ids),
        impact_path=impact_path
    )
