import os
import uuid
import asyncio
import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, desc, func
from pydantic import BaseModel

from config import settings
from database import init_db, get_db, Meeting
from schemas import (
    MeetingResponse,
    MeetingDetailResponse,
    MeetingUpdate,
    SearchResponse,
    MeetingCreate
)
from audio_processor import audio_processor
from llm_analyzer import llm_analyzer
from xmind_generator import xmind_generator
from realtime_transcriber import realtime_transcriber
from email_generator import email_generator


class EmailGenerateRequest(BaseModel):
    meeting_id: int
    template: str = "formal"
    recipients: Optional[List[str]] = None


class SaveRealtimeRequest(BaseModel):
    session_id: str
    title: str
    transcription: str
    segments: List[Dict[str, Any]] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    print("Database initialized")
    yield


app = FastAPI(
    title="会议录音分析工具",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")


async def process_meeting_background(
    meeting_id: int,
    file_path: str,
    num_speakers: Optional[int] = None
):
    async with get_db() as db:
        try:
            meeting = await db.get(Meeting, meeting_id)
            if not meeting:
                print(f"Meeting {meeting_id} not found")
                return

            meeting_title = meeting.title

            result = audio_processor.process_audio(file_path, num_speakers)

            analysis_result = llm_analyzer.analyze_transcription(
                result["transcription_with_speakers"]
            )

            speakers = list(set(seg["speaker"] for seg in result["segments"]))
            speakers.sort()

            xmind_path = xmind_generator.generate_xmind(
                meeting_id=meeting_id,
                title=meeting_title,
                decisions=analysis_result["decisions"],
                todos=analysis_result["todos"],
                disputes=analysis_result["disputes"],
                summary=analysis_result["summary"],
                speakers=speakers,
                transcription=result["transcription_with_speakers"]
            )

            meeting = await db.get(Meeting, meeting_id)
            if meeting:
                meeting.transcription = result["transcription_with_speakers"]
                meeting.speakers = result["segments"]
                meeting.decisions = analysis_result["decisions"]
                meeting.todos = analysis_result["todos"]
                meeting.disputes = analysis_result["disputes"]
                meeting.summary = analysis_result["summary"]
                meeting.duration = result["duration"]
                meeting.xmind_path = xmind_path
                meeting.status = "completed"
                await db.commit()

        except Exception as e:
            print(f"Error processing meeting {meeting_id}: {e}")
            meeting = await db.get(Meeting, meeting_id)
            if meeting:
                meeting.status = "failed"
                await db.commit()
        finally:
            if os.path.exists(file_path):
                os.unlink(file_path)


@app.post("/api/meetings/upload", response_model=MeetingResponse)
async def upload_meeting(
    file: UploadFile = File(...),
    title: Optional[str] = None,
    num_speakers: Optional[int] = Query(None, ge=1, le=10),
    db: AsyncSession = Depends(get_db)
):
    if not file.filename.endswith('.m4a'):
        raise HTTPException(status_code=400, detail="只支持 .m4a 格式的音频文件")

    file_id = str(uuid.uuid4())
    file_path = settings.UPLOAD_DIR / f"{file_id}.m4a"

    with open(file_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)

    meeting_title = title or file.filename.replace('.m4a', '')

    meeting = Meeting(
        filename=file.filename,
        title=meeting_title,
        created_at=datetime.now(),
        status="processing"
    )
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)

    asyncio.create_task(process_meeting_background(meeting.id, str(file_path), num_speakers))

    return meeting


@app.get("/api/meetings", response_model=List[MeetingResponse])
async def list_meetings(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Meeting)
        .order_by(desc(Meeting.created_at))
        .offset(skip)
        .limit(limit)
    )
    meetings = result.scalars().all()
    return meetings


@app.get("/api/meetings/search", response_model=SearchResponse)
async def search_meetings(
    q: str = Query(..., min_length=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    search_pattern = f"%{q}%"

    count_result = await db.execute(
        select(func.count(Meeting.id))
        .where(
            or_(
                Meeting.title.like(search_pattern),
                Meeting.transcription.like(search_pattern),
                Meeting.summary.like(search_pattern)
            )
        )
    )
    total = count_result.scalar()

    result = await db.execute(
        select(Meeting)
        .where(
            or_(
                Meeting.title.like(search_pattern),
                Meeting.transcription.like(search_pattern),
                Meeting.summary.like(search_pattern)
            )
        )
        .order_by(desc(Meeting.created_at))
        .offset(skip)
        .limit(limit)
    )
    meetings = result.scalars().all()

    return SearchResponse(meetings=meetings, total=total)


@app.get("/api/meetings/{meeting_id}", response_model=MeetingDetailResponse)
async def get_meeting(
    meeting_id: int,
    db: AsyncSession = Depends(get_db)
):
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")
    return meeting


@app.put("/api/meetings/{meeting_id}", response_model=MeetingDetailResponse)
async def update_meeting(
    meeting_id: int,
    meeting_update: MeetingUpdate,
    db: AsyncSession = Depends(get_db)
):
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")

    update_data = meeting_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(meeting, key, value)

    await db.commit()
    await db.refresh(meeting)
    return meeting


@app.delete("/api/meetings/{meeting_id}")
async def delete_meeting(
    meeting_id: int,
    db: AsyncSession = Depends(get_db)
):
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")

    if meeting.xmind_path and os.path.exists(meeting.xmind_path):
        os.unlink(meeting.xmind_path)

    await db.delete(meeting)
    await db.commit()
    return {"message": "删除成功"}


@app.get("/api/meetings/{meeting_id}/xmind")
async def download_xmind(
    meeting_id: int,
    db: AsyncSession = Depends(get_db)
):
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")

    if not meeting.xmind_path or not os.path.exists(meeting.xmind_path):
        raise HTTPException(status_code=404, detail="XMind 文件不存在")

    filename = f"{meeting.title}.xmind"
    return FileResponse(
        meeting.xmind_path,
        media_type="application/xmind",
        filename=filename
    )


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}


@app.websocket("/ws/realtime/{session_id}")
async def websocket_realtime(websocket: WebSocket, session_id: str):
    await websocket.accept()
    session = realtime_transcriber.create_session(session_id)
    print(f"Realtime session started: {session_id}")

    try:
        await websocket.send_json({
            "type": "connected",
            "session_id": session_id,
            "message": "实时转写会话已开始"
        })

        while True:
            data = await websocket.receive()
            
            if "bytes" in data:
                audio_bytes = data["bytes"]
                session.add_audio(audio_bytes)
                
                result = await session.process_buffer()
                if result:
                    await websocket.send_json({
                        "type": "transcript",
                        "data": result
                    })
            
            elif "text" in data:
                try:
                    message = json.loads(data["text"])
                    msg_type = message.get("type")
                    
                    if msg_type == "ping":
                        await websocket.send_json({"type": "pong"})
                    
                    elif msg_type == "get_transcript":
                        await websocket.send_json({
                            "type": "full_transcript",
                            "text": session.get_current_transcript()
                        })
                    
                    elif msg_type == "finalize":
                        final_result = session.finalize()
                        await websocket.send_json({
                            "type": "finalized",
                            "data": final_result
                        })
                        break
                        
                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        print(f"Realtime session disconnected: {session_id}")
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        realtime_transcriber.remove_session(session_id)
        print(f"Realtime session closed: {session_id}")


@app.post("/api/realtime/save")
async def save_realtime_meeting(
    request: SaveRealtimeRequest,
    db: AsyncSession = Depends(get_db)
):
    meeting = Meeting(
        filename=f"realtime_{request.session_id}.m4a",
        title=request.title,
        created_at=datetime.now(),
        transcription=request.transcription,
        speakers=request.segments,
        duration=0,
        status="realtime"
    )
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)

    return {
        "message": "实时会议已保存",
        "meeting_id": meeting.id
    }


@app.get("/api/email/templates")
async def get_email_templates():
    return {
        "templates": email_generator.get_available_templates()
    }


@app.post("/api/email/generate")
async def generate_email(
    request: EmailGenerateRequest,
    db: AsyncSession = Depends(get_db)
):
    meeting = await db.get(Meeting, request.meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")

    speakers = []
    if meeting.speakers:
        speakers = list(set(seg.get("speaker", "") for seg in meeting.speakers if seg.get("speaker")))
        speakers.sort()

    meeting_data = {
        "title": meeting.title,
        "decisions": meeting.decisions or [],
        "todos": meeting.todos or [],
        "disputes": meeting.disputes or [],
        "summary": meeting.summary or "",
        "speakers": speakers
    }

    email = email_generator.generate_email(
        meeting_data,
        template=request.template,
        recipients=request.recipients
    )

    markdown_email = email_generator.generate_markdown_email(
        meeting_data,
        template=request.template
    )

    return {
        "subject": email["subject"],
        "body": email["body"],
        "markdown": markdown_email,
        "recipients": email["recipients"],
        "template": email["template"]
    }


@app.get("/api/meetings/{meeting_id}/email")
async def get_meeting_email(
    meeting_id: int,
    template: str = Query("formal"),
    db: AsyncSession = Depends(get_db)
):
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")

    speakers = []
    if meeting.speakers:
        speakers = list(set(seg.get("speaker", "") for seg in meeting.speakers if seg.get("speaker")))
        speakers.sort()

    meeting_data = {
        "title": meeting.title,
        "decisions": meeting.decisions or [],
        "todos": meeting.todos or [],
        "disputes": meeting.disputes or [],
        "summary": meeting.summary or "",
        "speakers": speakers
    }

    email = email_generator.generate_email(meeting_data, template=template)
    markdown_email = email_generator.generate_markdown_email(meeting_data, template=template)

    return {
        "subject": email["subject"],
        "body": email["body"],
        "markdown": markdown_email,
        "template": template
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
