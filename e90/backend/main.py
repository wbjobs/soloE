from fastapi import FastAPI, Depends, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import List, Optional, Dict, Any
import base64
import json
import os
import sys
import uuid
import tempfile
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'cli'))

from database import Base, engine, get_db, Image, Block, AsyncTask, RebuildTask, Fragment, NodeContribution
from schemas import (
    ImageUploadRequest,
    ImageInfoResponse,
    BlockInfoResponse,
    RecoveryRequest,
    RecoveryResponse,
    TaskStatusResponse,
    FragmentUploadRequest,
    FragmentBatchUploadRequest,
    RebuildTaskCreateRequest,
    RebuildTaskResponse,
    RebuildStartRequest,
    NodeContributionResponse,
)
from task_manager import task_manager
from block_processor import BlockProcessor
from joint_decoder import JointDecoder

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="LDPC Image Protector API",
    description="后端服务用于存储磁盘镜像块的LDPC校验数据，支持数据恢复、交织保护和分布式重建",
    version="3.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 仪表板静态文件
dashboard_path = os.path.join(os.path.dirname(__file__), '..', 'dashboard')
if os.path.exists(dashboard_path):
    app.mount("/dashboard", StaticFiles(directory=dashboard_path, html=True), name="dashboard")


@app.post("/api/images/upload", response_model=ImageInfoResponse)
def upload_image(request: ImageUploadRequest, db: Session = Depends(get_db)):
    """上传磁盘镜像的块校验数据"""
    existing = db.query(Image).filter(Image.name == request.name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"镜像 '{request.name}' 已存在")

    image = Image(
        name=request.name,
        total_blocks=request.total_blocks,
        block_size=request.block_size,
        redundancy_rate=request.redundancy_rate,
        use_interleave=request.use_interleave,
        interleave_group_size=request.interleave_group_size if request.use_interleave else None,
        interleave_map=request.interleave_map,
    )
    db.add(image)
    db.flush()

    for block_data in request.blocks:
        parity_bytes = base64.b64decode(block_data.parity_data)
        block = Block(
            image_id=image.id,
            block_index=block_data.block_index,
            logical_index=block_data.logical_index,
            interleave_group=block_data.interleave_group,
            block_hash=block_data.block_hash,
            parity_data=parity_bytes,
        )
        db.add(block)

    db.commit()
    db.refresh(image)

    return ImageInfoResponse(
        id=image.id,
        name=image.name,
        total_blocks=image.total_blocks,
        block_size=image.block_size,
        redundancy_rate=image.redundancy_rate,
        use_interleave=image.use_interleave,
        interleave_group_size=image.interleave_group_size,
        interleave_map=image.interleave_map,
        created_at=image.created_at,
    )


@app.get("/api/images", response_model=List[ImageInfoResponse])
def list_images(db: Session = Depends(get_db)):
    """列出所有已存储的镜像"""
    images = db.query(Image).all()
    return [
        ImageInfoResponse(
            id=img.id,
            name=img.name,
            total_blocks=img.total_blocks,
            block_size=img.block_size,
            redundancy_rate=img.redundancy_rate,
            use_interleave=img.use_interleave,
            interleave_group_size=img.interleave_group_size,
            interleave_map=img.interleave_map,
            created_at=img.created_at,
        )
        for img in images
    ]


@app.get("/api/images/{image_name}", response_model=ImageInfoResponse)
def get_image_info(image_name: str, db: Session = Depends(get_db)):
    """获取指定镜像的信息"""
    image = db.query(Image).filter(Image.name == image_name).first()
    if not image:
        raise HTTPException(status_code=404, detail=f"镜像 '{image_name}' 不存在")
    return ImageInfoResponse(
        id=image.id,
        name=image.name,
        total_blocks=image.total_blocks,
        block_size=image.block_size,
        redundancy_rate=image.redundancy_rate,
        use_interleave=image.use_interleave,
        interleave_group_size=image.interleave_group_size,
        interleave_map=image.interleave_map,
        created_at=image.created_at,
    )


@app.get("/api/images/{image_name}/blocks", response_model=List[BlockInfoResponse])
def get_image_blocks(
    image_name: str,
    block_indices: Optional[str] = Query(None, description="块索引列表，逗号分隔"),
    db: Session = Depends(get_db),
):
    """获取镜像的块信息和校验数据"""
    image = db.query(Image).filter(Image.name == image_name).first()
    if not image:
        raise HTTPException(status_code=404, detail=f"镜像 '{image_name}' 不存在")

    query = db.query(Block).filter(Block.image_id == image.id)

    if block_indices:
        try:
            indices = [int(i.strip()) for i in block_indices.split(",")]
            query = query.filter(Block.block_index.in_(indices))
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的块索引格式")

    blocks = query.order_by(Block.block_index).all()

    return [
        BlockInfoResponse(
            block_index=blk.block_index,
            logical_index=blk.logical_index,
            interleave_group=blk.interleave_group,
            block_hash=blk.block_hash,
            parity_data=base64.b64encode(blk.parity_data).decode("utf-8"),
        )
        for blk in blocks
    ]


@app.post("/api/recovery/prepare", response_model=RecoveryResponse)
def prepare_recovery(request: RecoveryRequest, db: Session = Depends(get_db)):
    """准备恢复数据，返回可恢复块的校验数据"""
    image = db.query(Image).filter(Image.name == request.image_name).first()
    if not image:
        raise HTTPException(status_code=404, detail=f"镜像 '{request.image_name}' 不存在")

    if image.use_interleave:
        from interleaver import Interleaver
        if image.interleave_map:
            interleaver = Interleaver.from_mapping(image.interleave_map)
            analysis = interleaver.analyze_corruption(request.corrupted_blocks)
            if not analysis["can_recover"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"损坏超出恢复能力。单组最大损坏: {analysis['max_corruption_per_group']} > 可恢复: {analysis['max_recoverable_per_group']}"
                )

    blocks = db.query(Block).filter(
        Block.image_id == image.id,
        Block.block_index.in_(request.corrupted_blocks)
    ).all()

    found_indices = {blk.block_index for blk in blocks}
    requested_indices = set(request.corrupted_blocks)

    recoverable = list(found_indices & requested_indices)
    unrecoverable = list(requested_indices - found_indices)

    parity_data = {}
    for blk in blocks:
        parity_data[str(blk.block_index)] = base64.b64encode(blk.parity_data).decode("utf-8")

    return RecoveryResponse(
        recoverable_blocks=sorted(recoverable),
        unrecoverable_blocks=sorted(unrecoverable),
        parity_data=parity_data,
    )


@app.delete("/api/images/{image_name}")
def delete_image(image_name: str, db: Session = Depends(get_db)):
    """删除指定镜像及其所有校验数据"""
    image = db.query(Image).filter(Image.name == image_name).first()
    if not image:
        raise HTTPException(status_code=404, detail=f"镜像 '{image_name}' 不存在")
    db.delete(image)
    db.commit()
    return {"message": f"镜像 '{image_name}' 已删除"}


@app.get("/api/tasks/{task_id}", response_model=TaskStatusResponse)
def get_task_status(task_id: str, db: Session = Depends(get_db)):
    """获取异步任务状态"""
    status = task_manager.get_task_status(db, task_id)
    if not status:
        raise HTTPException(status_code=404, detail=f"任务 '{task_id}' 不存在")
    return TaskStatusResponse(**status)


@app.get("/api/tasks")
def list_tasks(
    image_name: Optional[str] = Query(None, description="按镜像名称过滤"),
    status: Optional[str] = Query(None, description="按状态过滤"),
    db: Session = Depends(get_db)
):
    """列出所有异步任务"""
    return task_manager.list_tasks(db, image_name=image_name, status=status)


@app.post("/api/images/upload/async")
async def upload_image_async(
    request: ImageUploadRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """异步上传镜像校验数据（适合大镜像）"""
    existing = db.query(Image).filter(Image.name == request.name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"镜像 '{request.name}' 已存在")

    def process_upload(blocks_data, image_info, **kwargs):
        from database import SessionLocal
        db_local = SessionLocal()
        try:
            image = Image(
                name=image_info["name"],
                total_blocks=image_info["total_blocks"],
                block_size=image_info["block_size"],
                redundancy_rate=image_info["redundancy_rate"],
                use_interleave=image_info["use_interleave"],
                interleave_group_size=image_info.get("interleave_group_size"),
                interleave_map=image_info.get("interleave_map"),
            )
            db_local.add(image)
            db_local.flush()

            total = len(blocks_data)
            for i, block_data in enumerate(blocks_data):
                parity_bytes = base64.b64decode(block_data["parity_data"])
                block = Block(
                    image_id=image.id,
                    block_index=block_data["block_index"],
                    logical_index=block_data.get("logical_index"),
                    interleave_group=block_data.get("interleave_group"),
                    block_hash=block_data["block_hash"],
                    parity_data=parity_bytes,
                )
                db_local.add(block)

                if i % 100 == 0:
                    db_local.commit()
                    if 'progress_callback' in kwargs:
                        kwargs['progress_callback'](i + 1, total)

            db_local.commit()
            return {"image_id": image.id, "name": image.name}
        finally:
            db_local.close()

    image_info = {
        "name": request.name,
        "total_blocks": request.total_blocks,
        "block_size": request.block_size,
        "redundancy_rate": request.redundancy_rate,
        "use_interleave": request.use_interleave,
        "interleave_group_size": request.interleave_group_size,
        "interleave_map": request.interleave_map,
    }

    blocks_dict = [b.dict() for b in request.blocks]

    task_id = task_manager.submit_task(
        db,
        task_type="image_upload",
        image_name=request.name,
        func=process_upload,
        blocks_data=blocks_dict,
        image_info=image_info,
    )

    return {
        "task_id": task_id,
        "status": "pending",
        "message": "镜像上传任务已提交，请使用 /api/tasks/{task_id} 查询进度"
    }


@app.get("/api/health")
def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "service": "LDPC Image Protector",
        "version": "3.0.0",
        "features": ["interleave", "async_tasks", "distributed_rebuild"]
    }


# ==================== 分布式重建 API ====================

@app.post("/api/rebuild/create", response_model=RebuildTaskResponse)
def create_rebuild_task(request: RebuildTaskCreateRequest, db: Session = Depends(get_db)):
    """创建分布式镜像重建任务"""
    image = db.query(Image).filter(Image.name == request.image_name).first()
    if not image:
        raise HTTPException(status_code=404, detail=f"镜像 '{request.image_name}' 不存在")

    task_id = str(uuid.uuid4())
    rebuild_task = RebuildTask(
        id=task_id,
        image_id=image.id,
        name=request.name,
        status="collecting",
        total_blocks=image.total_blocks,
        block_size=image.block_size,
        collected_blocks={},
        node_contributions={},
        recovered_blocks=[],
        unrecoverable_blocks=[],
        progress=0,
    )
    db.add(rebuild_task)
    db.commit()
    db.refresh(rebuild_task)

    return RebuildTaskResponse(
        task_id=rebuild_task.id,
        name=rebuild_task.name,
        image_name=request.image_name,
        status=rebuild_task.status,
        total_blocks=rebuild_task.total_blocks,
        block_size=rebuild_task.block_size,
        collected_count=0,
        recovered_count=0,
        unrecoverable_count=0,
        progress=0,
        node_contributions={},
        created_at=rebuild_task.created_at,
        updated_at=rebuild_task.updated_at,
    )


@app.post("/api/rebuild/fragment/upload")
def upload_fragment(request: FragmentUploadRequest, db: Session = Depends(get_db)):
    """上传单个块片段"""
    rebuild_task = db.query(RebuildTask).filter(RebuildTask.id == request.rebuild_task_id).first()
    if not rebuild_task:
        raise HTTPException(status_code=404, detail=f"重建任务 '{request.rebuild_task_id}' 不存在")

    if rebuild_task.status not in ["collecting", "recovering"]:
        raise HTTPException(status_code=400, detail=f"重建任务当前状态为 '{rebuild_task.status}'，不接受新片段")

    try:
        block_data = base64.b64decode(request.block_data)
    except Exception:
        raise HTTPException(status_code=400, detail="无效的 block_data 编码")

    image = rebuild_task.image
    expected_block = db.query(Block).filter(
        Block.image_id == image.id,
        Block.block_index == request.block_index
    ).first()

    is_valid = False
    block_hash = request.block_hash
    if expected_block:
        from ldpc import BlockHasher
        actual_hash = BlockHasher.compute_hash(block_data)
        is_valid = (actual_hash == expected_block.block_hash)
        block_hash = expected_block.block_hash

    fragment = Fragment(
        rebuild_task_id=request.rebuild_task_id,
        node_id=request.node_id,
        node_name=request.node_name,
        block_data=block_data,
        block_index=request.block_index,
        block_hash=block_hash,
        is_valid=is_valid,
    )
    db.add(fragment)

    collected = rebuild_task.collected_blocks or {}
    block_key = str(request.block_index)
    if block_key not in collected:
        collected[block_key] = []
    if request.node_id not in collected[block_key]:
        collected[block_key].append(request.node_id)
    rebuild_task.collected_blocks = collected

    contributions = rebuild_task.node_contributions or {}
    node_key = request.node_id
    if node_key not in contributions:
        contributions[node_key] = {"name": request.node_name, "count": 0, "unique": 0}
    contributions[node_key]["count"] += 1
    if len(collected[block_key]) == 1:
        contributions[node_key]["unique"] += 1
    rebuild_task.node_contributions = contributions

    node_contribution = db.query(NodeContribution).filter(
        NodeContribution.rebuild_task_id == request.rebuild_task_id,
        NodeContribution.node_id == request.node_id
    ).first()
    if not node_contribution:
        node_contribution = NodeContribution(
            rebuild_task_id=request.rebuild_task_id,
            node_id=request.node_id,
            node_name=request.node_name,
        )
        db.add(node_contribution)
    node_contribution.blocks_contributed += 1
    if len(collected[block_key]) == 1:
        node_contribution.unique_blocks += 1

    collected_count = len(collected)
    rebuild_task.progress = int((collected_count / rebuild_task.total_blocks) * 100)

    db.commit()

    return {
        "status": "success",
        "block_index": request.block_index,
        "is_valid": is_valid,
        "collected_count": collected_count,
        "total_blocks": rebuild_task.total_blocks,
        "progress": rebuild_task.progress,
    }


@app.post("/api/rebuild/fragment/batch")
def upload_fragment_batch(request: FragmentBatchUploadRequest, db: Session = Depends(get_db)):
    """批量上传块片段"""
    results = []
    for frag in request.fragments:
        single_request = FragmentUploadRequest(
            rebuild_task_id=request.rebuild_task_id,
            node_id=request.node_id,
            node_name=request.node_name,
            block_index=frag.block_index,
            block_data=frag.block_data,
            block_hash=frag.block_hash,
        )
        try:
            result = upload_fragment(single_request, db)
            results.append(result)
        except Exception as e:
            results.append({"block_index": frag.block_index, "error": str(e)})

    return {"uploaded": len(results), "results": results}


@app.get("/api/rebuild/{task_id}", response_model=RebuildTaskResponse)
def get_rebuild_status(task_id: str, db: Session = Depends(get_db)):
    """获取重建任务状态"""
    rebuild_task = db.query(RebuildTask).filter(RebuildTask.id == task_id).first()
    if not rebuild_task:
        raise HTTPException(status_code=404, detail=f"重建任务 '{task_id}' 不存在")

    image = rebuild_task.image
    collected_count = len(rebuild_task.collected_blocks or {})

    return RebuildTaskResponse(
        task_id=rebuild_task.id,
        name=rebuild_task.name,
        image_name=image.name,
        status=rebuild_task.status,
        total_blocks=rebuild_task.total_blocks,
        block_size=rebuild_task.block_size,
        collected_count=collected_count,
        recovered_count=len(rebuild_task.recovered_blocks or []),
        unrecoverable_count=len(rebuild_task.unrecoverable_blocks or []),
        progress=rebuild_task.progress,
        node_contributions=rebuild_task.node_contributions or {},
        created_at=rebuild_task.created_at,
        updated_at=rebuild_task.updated_at,
    )


@app.get("/api/rebuild")
def list_rebuild_tasks(
    image_name: Optional[str] = Query(None, description="按镜像名称过滤"),
    status: Optional[str] = Query(None, description="按状态过滤"),
    db: Session = Depends(get_db)
):
    """列出所有重建任务"""
    query = db.query(RebuildTask)

    if image_name:
        image = db.query(Image).filter(Image.name == image_name).first()
        if image:
            query = query.filter(RebuildTask.image_id == image.id)

    if status:
        query = query.filter(RebuildTask.status == status)

    tasks = query.order_by(RebuildTask.created_at.desc()).all()

    return [
        {
            "task_id": task.id,
            "name": task.name,
            "image_name": task.image.name,
            "status": task.status,
            "total_blocks": task.total_blocks,
            "collected_count": len(task.collected_blocks or {}),
            "progress": task.progress,
            "created_at": task.created_at.isoformat(),
        }
        for task in tasks
    ]


@app.post("/api/rebuild/start")
def start_rebuild(request: RebuildStartRequest, background_tasks: BackgroundTasks,
                  db: Session = Depends(get_db)):
    """开始执行联合解码重建"""
    rebuild_task = db.query(RebuildTask).filter(RebuildTask.id == request.rebuild_task_id).first()
    if not rebuild_task:
        raise HTTPException(status_code=404, detail=f"重建任务 '{request.rebuild_task_id}' 不存在")

    if rebuild_task.status not in ["collecting", "failed"]:
        raise HTTPException(status_code=400, detail=f"重建任务当前状态为 '{rebuild_task.status}'，无法开始重建")

    rebuild_task.status = "recovering"
    db.commit()

    def process_rebuild(task_id: str, **kwargs):
        from database import SessionLocal
        db_local = SessionLocal()
        try:
            task = db_local.query(RebuildTask).filter(RebuildTask.id == task_id).first()
            if not task:
                return

            task.status = "recovering"
            task.message = "正在收集片段数据..."
            db_local.commit()

            image = task.image
            fragments = db_local.query(Fragment).filter(Fragment.rebuild_task_id == task_id).all()
            expected_blocks = db_local.query(Block).filter(Block.image_id == image.id).all()

            all_fragments = []
            for frag in fragments:
                all_fragments.append({
                    "node_id": frag.node_id,
                    "block_index": frag.block_index,
                    "block_data": frag.block_data,
                    "is_valid": frag.is_valid,
                })

            parity_map = {}
            expected_hashes = {}
            for blk in expected_blocks:
                parity_map[blk.block_index] = blk.parity_data
                expected_hashes[blk.block_index] = blk.block_hash

            task.message = "正在执行联合解码..."
            db_local.commit()

            decoder = JointDecoder(redundancy_rate=image.redundancy_rate)
            reconstructed_data, stats = decoder.rebuild_image(
                total_blocks=image.total_blocks,
                all_fragments=all_fragments,
                parity_map=parity_map,
                expected_hashes=expected_hashes,
                block_size=image.block_size
            )

            if 'progress_callback' in kwargs:
                kwargs['progress_callback'](90, 100)

            task.message = "正在保存重建结果..."
            db_local.commit()

            output_dir = os.path.join(tempfile.gettempdir(), "ldpc_rebuild")
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, f"{task.name}_{task_id}.img")

            with open(output_path, 'wb') as f:
                f.write(reconstructed_data)

            task.result_path = output_path
            task.recovered_blocks = stats["recovered_blocks"]
            task.unrecoverable_blocks = stats["unrecoverable_blocks"]
            task.progress = 100
            task.status = "completed"
            task.message = f"重建完成，恢复率: {stats['recovery_rate'] * 100:.1f}%"
            db_local.commit()

            return {
                "recovery_rate": stats["recovery_rate"],
                "recovered": len(stats["recovered_blocks"]),
                "unrecoverable": len(stats["unrecoverable_blocks"]),
                "methods": stats["recovery_methods"],
            }

        except Exception as e:
            task = db_local.query(RebuildTask).filter(RebuildTask.id == task_id).first()
            if task:
                task.status = "failed"
                task.error = str(e)
                db_local.commit()
            return {"error": str(e)}
        finally:
            db_local.close()

    task_id = task_manager.submit_task(
        db,
        task_type="image_rebuild",
        image_name=rebuild_task.image.name,
        func=process_rebuild,
        task_id=request.rebuild_task_id,
    )

    return {
        "task_id": request.rebuild_task_id,
        "async_task_id": task_id,
        "status": "recovering",
        "message": "重建任务已启动，请使用 /api/rebuild/{task_id} 查询进度"
    }


@app.get("/api/rebuild/{task_id}/download")
def download_rebuilt_image(task_id: str, db: Session = Depends(get_db)):
    """下载重建完成的镜像"""
    rebuild_task = db.query(RebuildTask).filter(RebuildTask.id == task_id).first()
    if not rebuild_task:
        raise HTTPException(status_code=404, detail=f"重建任务 '{task_id}' 不存在")

    if rebuild_task.status != "completed":
        raise HTTPException(status_code=400, detail=f"重建任务尚未完成，当前状态: {rebuild_task.status}")

    if not rebuild_task.result_path or not os.path.exists(rebuild_task.result_path):
        raise HTTPException(status_code=404, detail="重建结果文件不存在")

    filename = f"{rebuild_task.name}_rebuilt.img"
    return FileResponse(
        rebuild_task.result_path,
        media_type="application/octet-stream",
        filename=filename
    )


@app.get("/api/rebuild/{task_id}/nodes", response_model=List[NodeContributionResponse])
def get_node_contributions(task_id: str, db: Session = Depends(get_db)):
    """获取各节点的贡献统计"""
    rebuild_task = db.query(RebuildTask).filter(RebuildTask.id == task_id).first()
    if not rebuild_task:
        raise HTTPException(status_code=404, detail=f"重建任务 '{task_id}' 不存在")

    contributions = db.query(NodeContribution).filter(
        NodeContribution.rebuild_task_id == task_id
    ).order_by(NodeContribution.blocks_contributed.desc()).all()

    return [
        NodeContributionResponse(
            node_id=contrib.node_id,
            node_name=contrib.node_name,
            blocks_contributed=contrib.blocks_contributed,
            unique_blocks=contrib.unique_blocks,
            last_seen=contrib.last_seen,
        )
        for contrib in contributions
    ]


@app.get("/api/rebuild/{task_id}/heatmap")
def get_block_heatmap(task_id: str, db: Session = Depends(get_db)):
    """获取块收集热力图数据（用于仪表板显示）"""
    rebuild_task = db.query(RebuildTask).filter(RebuildTask.id == task_id).first()
    if not rebuild_task:
        raise HTTPException(status_code=404, detail=f"重建任务 '{task_id}' 不存在")

    image = rebuild_task.image
    collected = rebuild_task.collected_blocks or {}
    recovered = set(rebuild_task.recovered_blocks or [])
    unrecoverable = set(rebuild_task.unrecoverable_blocks or [])

    fragments = db.query(Fragment).filter(Fragment.rebuild_task_id == task_id).all()
    block_sources: Dict[int, List[str]] = {}
    for frag in fragments:
        if frag.block_index not in block_sources:
            block_sources[frag.block_index] = []
        if frag.node_id not in block_sources[frag.block_index]:
            block_sources[frag.block_index].append(frag.node_id)

    heatmap = []
    for block_index in range(image.total_blocks):
        block_key = str(block_index)
        sources = block_sources.get(block_index, [])

        if block_index in unrecoverable:
            status = "unrecoverable"
        elif block_index in recovered:
            status = "recovered"
        elif block_key in collected:
            status = "collected"
        else:
            status = "missing"

        heatmap.append({
            "block_index": block_index,
            "status": status,
            "sources": sources,
            "source_count": len(sources),
        })

    return {
        "task_id": task_id,
        "total_blocks": image.total_blocks,
        "heatmap": heatmap,
        "stats": {
            "recovered": len(recovered),
            "unrecoverable": len(unrecoverable),
            "collected": len(collected),
            "missing": image.total_blocks - len(collected),
        }
    }
