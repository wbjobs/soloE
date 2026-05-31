from pydantic import BaseModel
from typing import Dict, List, Optional


class TrackResponse(BaseModel):
    status: str
    container_id: str
    message: str


class StopResponse(BaseModel):
    status: str
    container_id: str
    message: str


class SyscallStats(BaseModel):
    count: int
    bytes: int


class AggregatedResult(BaseModel):
    process_name: str
    file_path: str
    syscall_stats: Dict[str, SyscallStats]
    total_calls: int


class ResultsResponse(BaseModel):
    container_id: str
    results: List[AggregatedResult]
    total_entries: int
    lost_events: int
    has_lost_events: bool
    start_time_ns: Optional[int] = None
    end_time_ns: Optional[int] = None


class StatsResponse(BaseModel):
    container_id: str
    is_tracking: bool
    total_events: int
    tracking_duration_ms: int
    unique_processes: int
    unique_files: int
    total_lost_events: int
    has_lost_events: bool


class HotFile(BaseModel):
    file_path: str
    read_count: int
    write_count: int
    read_bytes: int
    write_bytes: int
    total_count: int
    read_ratio: float
    write_ratio: float
    ratio_label: str


class HotFilesResponse(BaseModel):
    container_id: str
    hot_files: List[HotFile]
    total_files: int
    start_time_ns: Optional[int] = None
    end_time_ns: Optional[int] = None
    generated_at: int
