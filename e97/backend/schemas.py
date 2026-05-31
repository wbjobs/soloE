from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Dict, Any


class MeetingBase(BaseModel):
    title: str


class MeetingCreate(MeetingBase):
    pass


class MeetingUpdate(BaseModel):
    title: Optional[str] = None
    transcription: Optional[str] = None
    speakers: Optional[List[Dict[str, Any]]] = None
    decisions: Optional[List[str]] = None
    todos: Optional[List[Dict[str, Any]]] = None
    disputes: Optional[List[Dict[str, Any]]] = None
    summary: Optional[str] = None
    status: Optional[str] = None


class MeetingResponse(BaseModel):
    id: int
    filename: str
    title: str
    created_at: datetime
    duration: Optional[int] = None
    status: str
    summary: Optional[str] = None

    class Config:
        from_attributes = True


class MeetingDetailResponse(MeetingResponse):
    transcription: Optional[str] = None
    speakers: Optional[List[Dict[str, Any]]] = None
    decisions: Optional[List[str]] = None
    todos: Optional[List[Dict[str, Any]]] = None
    disputes: Optional[List[Dict[str, Any]]] = None
    xmind_path: Optional[str] = None


class TranscriptionSegment(BaseModel):
    start: float
    end: float
    text: str
    speaker: Optional[str] = None


class AnalysisResult(BaseModel):
    decisions: List[str]
    todos: List[Dict[str, Any]]
    disputes: List[Dict[str, Any]]
    summary: str


class SearchResponse(BaseModel):
    meetings: List[MeetingResponse]
    total: int
