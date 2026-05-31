from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime


class BlockData(BaseModel):
    block_index: int
    logical_index: Optional[int] = None
    interleave_group: Optional[int] = None
    block_hash: str
    parity_data: str


class ImageUploadRequest(BaseModel):
    name: str
    total_blocks: int
    block_size: int = 4096
    redundancy_rate: float = 0.2
    use_interleave: bool = False
    interleave_group_size: int = 64
    interleave_map: Optional[Dict[str, Any]] = None
    blocks: List[BlockData]


class BlockInfoResponse(BaseModel):
    block_index: int
    logical_index: Optional[int] = None
    interleave_group: Optional[int] = None
    block_hash: str
    parity_data: str


class ImageInfoResponse(BaseModel):
    id: int
    name: str
    total_blocks: int
    block_size: int
    redundancy_rate: float
    use_interleave: bool
    interleave_group_size: Optional[int] = None
    interleave_map: Optional[Dict[str, Any]] = None
    created_at: datetime


class RecoveryRequest(BaseModel):
    image_name: str
    corrupted_blocks: List[int]


class RecoveryResponse(BaseModel):
    recoverable_blocks: List[int]
    unrecoverable_blocks: List[int]
    parity_data: dict


class TaskStatusResponse(BaseModel):
    task_id: str
    task_type: str
    status: str
    image_name: str
    progress: int
    total: int
    message: Optional[str] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AsyncImageUploadRequest(BaseModel):
    name: str
    image_path: str
    block_size: int = 4096
    redundancy_rate: float = 0.2
    use_interleave: bool = False
    interleave_group_size: int = 64


class AsyncRecoveryRequest(BaseModel):
    image_name: str
    image_path: str
    output_path: Optional[str] = None


class FragmentUploadRequest(BaseModel):
    rebuild_task_id: str
    node_id: str
    node_name: Optional[str] = None
    block_index: int
    block_data: str
    block_hash: Optional[str] = None


class FragmentBatchUploadRequest(BaseModel):
    rebuild_task_id: str
    node_id: str
    node_name: Optional[str] = None
    fragments: List[FragmentUploadRequest]


class RebuildTaskCreateRequest(BaseModel):
    image_name: str
    name: str
    description: Optional[str] = None


class RebuildTaskResponse(BaseModel):
    task_id: str
    name: str
    image_name: str
    status: str
    total_blocks: int
    block_size: int
    collected_count: int
    recovered_count: int
    unrecoverable_count: int
    progress: int
    node_contributions: Dict[str, Any]
    created_at: datetime
    updated_at: datetime


class NodeContributionResponse(BaseModel):
    node_id: str
    node_name: Optional[str]
    blocks_contributed: int
    unique_blocks: int
    last_seen: datetime


class RebuildStartRequest(BaseModel):
    rebuild_task_id: str


class BlockHeatmapData(BaseModel):
    block_index: int
    status: str
    sources: List[str]

