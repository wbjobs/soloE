from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import List, Optional, Dict
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://ebpf:ebpf123@localhost:5432/service_topology")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class ConnectionRecord(Base):
    __tablename__ = "connections"
    
    id = Column(Integer, primary_key=True, index=True)
    src_ip = Column(String, index=True)
    src_port = Column(Integer)
    src_service = Column(String, index=True)
    src_pid = Column(Integer)
    dst_ip = Column(String, index=True)
    dst_port = Column(Integer)
    dst_service = Column(String, index=True)
    protocol = Column(String)
    count = Column(Integer, default=1)
    error_count = Column(Integer, default=0)
    timestamp = Column(DateTime, index=True)

class NodePosition(Base):
    __tablename__ = "node_positions"
    
    id = Column(String, primary_key=True, index=True)
    x = Column(Float, default=0)
    y = Column(Float, default=0)
    fixed = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

Base.metadata.create_all(bind=engine)

class ConnectionData(BaseModel):
    src_ip: str
    src_port: int
    src_service: str
    src_pid: int
    dst_ip: str
    dst_port: int
    dst_service: str
    protocol: str
    count: int
    error_count: int = 0
    timestamp: float

class NodePositionData(BaseModel):
    id: str
    x: float
    y: float
    fixed: bool = False

class ServiceNode(BaseModel):
    id: str
    name: str
    ip: str
    size: int
    total_calls: int
    error_calls: int
    error_rate: float
    x: Optional[float] = None
    y: Optional[float] = None
    fixed: Optional[bool] = None

class ServiceEdge(BaseModel):
    source: str
    target: str
    value: int
    protocol: str
    error_count: int
    error_rate: float

class TopologyData(BaseModel):
    nodes: List[ServiceNode]
    edges: List[ServiceEdge]

app = FastAPI(title="eBPF Service Topology API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.post("/api/connections")
async def receive_connections(connections: List[ConnectionData], db: Session = Depends(get_db)):
    for conn in connections:
        db_conn = ConnectionRecord(
            src_ip=conn.src_ip,
            src_port=conn.src_port,
            src_service=conn.src_service,
            src_pid=conn.src_pid,
            dst_ip=conn.dst_ip,
            dst_port=conn.dst_port,
            dst_service=conn.dst_service,
            protocol=conn.protocol,
            count=conn.count,
            error_count=conn.error_count,
            timestamp=datetime.fromtimestamp(conn.timestamp),
        )
        db.add(db_conn)
    db.commit()
    return {"status": "success", "received": len(connections)}

@app.get("/api/topology", response_model=TopologyData)
async def get_topology(
    start_time: Optional[float] = None,
    end_time: Optional[float] = None,
    db: Session = Depends(get_db)
):
    query = db.query(ConnectionRecord)
    
    if start_time:
        query = query.filter(ConnectionRecord.timestamp >= datetime.fromtimestamp(start_time))
    if end_time:
        query = query.filter(ConnectionRecord.timestamp <= datetime.fromtimestamp(end_time))
    
    if not start_time and not end_time:
        default_end = datetime.now()
        default_start = default_end - timedelta(hours=1)
        query = query.filter(ConnectionRecord.timestamp >= default_start)
    
    connections = query.all()
    
    nodes_dict = {}
    edges_dict = {}
    node_error_stats = {}
    
    for conn in connections:
        src_key = f"{conn.src_service}_{conn.src_ip}"
        dst_key = f"{conn.dst_service}_{conn.dst_ip}"
        
        if src_key not in nodes_dict:
            nodes_dict[src_key] = {
                "id": src_key,
                "name": conn.src_service,
                "ip": conn.src_ip,
                "size": 0,
                "total_calls": 0,
                "error_calls": 0,
            }
        nodes_dict[src_key]["size"] += conn.count
        nodes_dict[src_key]["total_calls"] += conn.count
        
        if dst_key not in nodes_dict:
            nodes_dict[dst_key] = {
                "id": dst_key,
                "name": conn.dst_service,
                "ip": conn.dst_ip,
                "size": 0,
                "total_calls": 0,
                "error_calls": 0,
            }
        nodes_dict[dst_key]["size"] += conn.count
        nodes_dict[dst_key]["total_calls"] += conn.count
        nodes_dict[dst_key]["error_calls"] += conn.error_count
        
        edge_key = f"{src_key}|{dst_key}|{conn.protocol}"
        if edge_key not in edges_dict:
            edges_dict[edge_key] = {
                "source": src_key,
                "target": dst_key,
                "value": 0,
                "protocol": conn.protocol,
                "error_count": 0,
            }
        edges_dict[edge_key]["value"] += conn.count
        edges_dict[edge_key]["error_count"] += conn.error_count
    
    for node in nodes_dict.values():
        node["error_rate"] = node["error_calls"] / node["total_calls"] if node["total_calls"] > 0 else 0.0
    
    for edge in edges_dict.values():
        edge["error_rate"] = edge["error_count"] / edge["value"] if edge["value"] > 0 else 0.0
    
    node_ids = list(nodes_dict.keys())
    positions = db.query(NodePosition).filter(NodePosition.id.in_(node_ids)).all()
    pos_dict = {pos.id: pos for pos in positions}
    
    nodes = []
    for node_id, node_data in nodes_dict.items():
        pos = pos_dict.get(node_id)
        if pos:
            node_data["x"] = pos.x
            node_data["y"] = pos.y
            node_data["fixed"] = pos.fixed
        nodes.append(ServiceNode(**node_data))
    
    edges = [ServiceEdge(**edge) for edge in edges_dict.values()]
    
    return TopologyData(nodes=nodes, edges=edges)

@app.post("/api/nodes/position")
async def save_node_position(
    positions: List[NodePositionData],
    db: Session = Depends(get_db)
):
    for pos in positions:
        existing = db.query(NodePosition).filter(NodePosition.id == pos.id).first()
        if existing:
            existing.x = pos.x
            existing.y = pos.y
            existing.fixed = pos.fixed
        else:
            new_pos = NodePosition(
                id=pos.id,
                x=pos.x,
                y=pos.y,
                fixed=pos.fixed
            )
            db.add(new_pos)
    db.commit()
    return {"status": "success", "saved": len(positions)}

@app.get("/api/nodes/positions")
async def get_all_node_positions(db: Session = Depends(get_db)):
    positions = db.query(NodePosition).all()
    return {
        "positions": [
            {
                "id": pos.id,
                "x": pos.x,
                "y": pos.y,
                "fixed": pos.fixed
            }
            for pos in positions
        ]
    }

@app.get("/api/time-range")
async def get_time_range(db: Session = Depends(get_db)):
    from sqlalchemy import func
    result = db.query(
        func.min(ConnectionRecord.timestamp),
        func.max(ConnectionRecord.timestamp)
    ).first()
    
    min_ts = result[0].timestamp() if result[0] else datetime.now().timestamp()
    max_ts = result[1].timestamp() if result[1] else datetime.now().timestamp()
    
    return {
        "min_time": min_ts,
        "max_time": max_ts,
    }

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
