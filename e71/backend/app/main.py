from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, LargeBinary, func, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timedelta
import numpy as np
import librosa
import io
from PIL import Image
import base64

import os

try:
    DATABASE_URL = "postgresql://postgres:password@localhost:5432/grain_pest_db"
    engine = create_engine(DATABASE_URL)
    with engine.connect():
        pass
except Exception:
    DATABASE_URL = "sqlite:///./grain_pest.db"
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class DetectionResult(Base):
    __tablename__ = "grain_pest_detection"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, index=True)
    granary_id = Column(String, index=True, default="default")
    pest_confidence = Column(Float)
    is_pest = Column(Integer)
    spectrogram = Column(LargeBinary)
    created_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="粮仓害虫检测API")

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

def generate_mock_prediction(audio_data):
    np.random.seed(int.from_bytes(audio_data[:4], 'big') if len(audio_data) >= 4 else 42)
    pest_confidence = np.random.uniform(0.0, 1.0)
    is_pest = 1 if pest_confidence > 0.5 else 0
    return pest_confidence, is_pest

def generate_spectrogram(audio_bytes):
    try:
        y, sr = librosa.load(io.BytesIO(audio_bytes), sr=None)
        D = librosa.amplitude_to_db(np.abs(librosa.stft(y)), ref=np.max)
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        
        plt.figure(figsize=(10, 4))
        librosa.display.specshow(D, sr=sr, x_axis='time', y_axis='hz')
        plt.colorbar(format='%+2.0f dB')
        plt.tight_layout()
        
        buf = io.BytesIO()
        plt.savefig(buf, format='png')
        buf.seek(0)
        plt.close()
        return buf.getvalue()
    except Exception as e:
        np.random.seed(42)
        img = Image.new('RGB', (100, 100), color=(77, 77, 77))
        buf = io.BytesIO()
        img.save(buf, format='png')
        buf.seek(0)
        return buf.getvalue()

MAX_FILE_SIZE = 10 * 1024 * 1024

@app.post("/api/detect")
@app.post("/api/analyze")
async def detect_pest(file: UploadFile = File(...), granary_id: str = Form("default")):
    if not file.filename.lower().endswith(('.wav', '.mp3', '.flac', '.ogg')):
        raise HTTPException(status_code=400, detail="不支持的音频格式")
    
    try:
        audio_data = await file.read()
        if len(audio_data) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"文件大小超过限制，最大支持 10MB，当前文件大小: {len(audio_data) // (1024 * 1024)}MB")
        
        pest_confidence, is_pest = generate_mock_prediction(audio_data)
        spectrogram_data = generate_spectrogram(audio_data)
        
        db = next(get_db())
        result = DetectionResult(
            filename=file.filename,
            granary_id=granary_id,
            pest_confidence=pest_confidence,
            is_pest=is_pest,
            spectrogram=spectrogram_data
        )
        db.add(result)
        db.commit()
        db.refresh(result)
        
        spectrogram_base64 = base64.b64encode(spectrogram_data).decode('utf-8')
        
        return JSONResponse(content={
            "id": result.id,
            "filename": result.filename,
            "granary_id": result.granary_id,
            "pest_confidence": round(pest_confidence * 100, 2),
            "is_pest": is_pest,
            "spectrogram": spectrogram_base64,
            "created_at": result.created_at.isoformat()
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history")
async def get_history(page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=50)):
    db = next(get_db())
    total = db.query(DetectionResult).count()
    skip = (page - 1) * page_size
    results = db.query(DetectionResult).order_by(DetectionResult.created_at.desc()).offset(skip).limit(page_size).all()
    
    history = []
    for r in results:
        spectrogram_base64 = base64.b64encode(r.spectrogram).decode('utf-8') if r.spectrogram else None
        history.append({
            "id": r.id,
            "filename": r.filename,
            "granary_id": r.granary_id,
            "pest_confidence": round(r.pest_confidence * 100, 2),
            "is_pest": r.is_pest,
            "spectrogram": spectrogram_base64,
            "created_at": r.created_at.isoformat()
        })
    
    return JSONResponse(content={
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": history
    })

@app.get("/api/granaries")
async def get_granaries():
    db = next(get_db())
    results = db.query(DetectionResult.granary_id).distinct().all()
    granaries = [r[0] for r in results if r[0]]
    if not granaries:
        granaries = ["粮仓A", "粮仓B", "粮仓C"]
    return JSONResponse(content={"granaries": granaries})

@app.get("/api/granary-stats")
async def get_granary_stats(granary_ids: str = Query(...), days: int = Query(7, ge=1, le=30)):
    if not granary_ids:
        raise HTTPException(status_code=400, detail="请指定至少一个粮仓ID")
    
    granary_list = [g.strip() for g in granary_ids.split(",") if g.strip()]
    if len(granary_list) < 1 or len(granary_list) > 3:
        raise HTTPException(status_code=400, detail="请选择 1-3 个粮仓进行对比")
    
    db = next(get_db())
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)
    
    stats = []
    for gid in granary_list:
        count = db.query(DetectionResult).filter(
            DetectionResult.granary_id == gid,
            DetectionResult.is_pest == 1,
            DetectionResult.created_at >= start_date,
            DetectionResult.created_at <= end_date
        ).count()
        
        total_detections = db.query(DetectionResult).filter(
            DetectionResult.granary_id == gid,
            DetectionResult.created_at >= start_date,
            DetectionResult.created_at <= end_date
        ).count()
        
        daily_data = []
        for i in range(days):
            day_start = start_date + timedelta(days=i)
            day_end = day_start + timedelta(days=1)
            day_count = db.query(DetectionResult).filter(
                DetectionResult.granary_id == gid,
                DetectionResult.is_pest == 1,
                DetectionResult.created_at >= day_start,
                DetectionResult.created_at < day_end
            ).count()
            daily_data.append({
                "date": day_start.strftime("%m-%d"),
                "count": day_count
            })
        
        stats.append({
            "granary_id": gid,
            "pest_count": count,
            "total_detections": total_detections,
            "daily_data": daily_data
        })
    
    return JSONResponse(content={
        "start_date": start_date.strftime("%Y-%m-%d"),
        "end_date": end_date.strftime("%Y-%m-%d"),
        "days": days,
        "data": stats
    })

@app.post("/api/generate-mock-data")
async def generate_mock_data():
    db = next(get_db())
    granaries = ["粮仓A", "粮仓B", "粮仓C"]
    
    for i in range(50):
        import random
        granary = random.choice(granaries)
        is_pest = random.choice([0, 1])
        days_ago = random.randint(0, 7)
        hours_ago = random.randint(0, 23)
        created_at = datetime.utcnow() - timedelta(days=days_ago, hours=hours_ago)
        
        result = DetectionResult(
            filename=f"mock_{i}.wav",
            granary_id=granary,
            pest_confidence=random.uniform(0.3, 0.95),
            is_pest=is_pest,
            spectrogram=None,
            created_at=created_at
        )
        db.add(result)
    
    db.commit()
    return JSONResponse(content={"message": "Mock数据生成成功", "count": 50})

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)