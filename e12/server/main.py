from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, Float, Integer, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from datetime import datetime
from typing import List, Optional
import os

DATABASE_URL = "sqlite:///./tasks.db"

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class TaskModel(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, index=True)
    task_name = Column(String, index=True)
    status = Column(String, index=True)
    worker_name = Column(String)
    execution_time = Column(Float)
    queue_name = Column(String)
    retries = Column(Integer)
    timestamp = Column(DateTime)


Base.metadata.create_all(bind=engine)


class Task(BaseModel):
    task_id: str
    task_name: str
    status: str
    worker_name: str
    execution_time: float
    queue_name: str
    retries: int
    timestamp: str

    class Config:
        orm_mode = True


class TaskCreateRequest(BaseModel):
    tasks: List[Task]


class TaskResponse(BaseModel):
    id: int
    task_id: str
    task_name: str
    status: str
    worker_name: str
    execution_time: float
    queue_name: str
    retries: int
    timestamp: datetime

    class Config:
        orm_mode = True


app = FastAPI(title="Task Queue Monitor API")

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


def parse_timestamp(ts_str: str) -> datetime:
    try:
        if ts_str.endswith('Z'):
            ts_str = ts_str.replace('Z', '+00:00')
        return datetime.fromisoformat(ts_str)
    except ValueError:
        try:
            return datetime.strptime(ts_str, "%Y-%m-%dT%H:%M:%S.%f")
        except ValueError:
            return datetime.utcnow()


@app.post("/api/v1/tasks", status_code=201)
def create_tasks(request: TaskCreateRequest, db: Session = Depends(get_db)):
    success_count = 0
    for task in request.tasks:
        try:
            db_task = TaskModel(
                task_id=task.task_id,
                task_name=task.task_name,
                status=task.status,
                worker_name=task.worker_name,
                execution_time=task.execution_time,
                queue_name=task.queue_name,
                retries=task.retries,
                timestamp=parse_timestamp(task.timestamp)
            )
            db.add(db_task)
            success_count += 1
        except Exception as e:
            print(f"Error inserting task {task.task_id}: {str(e)}")
            continue
    db.commit()
    return {"status": "success", "count": success_count}


@app.get("/api/v1/tasks", response_model=List[TaskResponse])
def get_tasks(
    status: Optional[str] = None,
    task_name: Optional[str] = None,
    worker_name: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    query = db.query(TaskModel)
    
    if status:
        query = query.filter(TaskModel.status == status)
    if task_name:
        query = query.filter(TaskModel.task_name == task_name)
    if worker_name:
        query = query.filter(TaskModel.worker_name == worker_name)
    
    tasks = query.order_by(TaskModel.timestamp.desc()).offset(offset).limit(limit).all()
    return tasks


@app.get("/api/v1/tasks/stats")
def get_task_stats(
    minutes: int = 60,
    db: Session = Depends(get_db)
):
    from sqlalchemy import func, text
    
    query = text("""
        SELECT 
            strftime('%Y-%m-%d %H:%M:00', timestamp) as minute,
            SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_count,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_count,
            COUNT(*) as total_count
        FROM tasks
        WHERE timestamp >= datetime('now', '-' || :minutes || ' minutes')
        GROUP BY minute
        ORDER BY minute ASC
    """)
    
    result = db.execute(query, {"minutes": minutes}).fetchall()
    
    stats = []
    for row in result:
        stats.append({
            "minute": row[0],
            "success_count": row[1],
            "failed_count": row[2],
            "total_count": row[3]
        })
    
    return {"stats": stats, "minutes": minutes}


@app.get("/api/v1/health")
def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
