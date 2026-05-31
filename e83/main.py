import signal
import sys
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from tracker import TrackerManager, Storage
from models import (
    TrackResponse,
    StopResponse,
    ResultsResponse,
    AggregatedResult,
    StatsResponse,
    HotFile,
    HotFilesResponse,
)


storage = Storage()
tracker_manager = TrackerManager(storage)


@asynccontextmanager
async def lifespan(app: FastAPI):
    def signal_handler(signum, frame):
        tracker_manager.cleanup()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    yield
    tracker_manager.cleanup()


app = FastAPI(
    title="eBPF Docker Syscall Tracker API",
    description="Track filesystem syscalls in Docker containers using eBPF",
    version="1.0.0",
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return {
        "name": "eBPF Docker Syscall Tracker",
        "version": "1.0.0",
        "endpoints": {
            "POST /track/{container_id}": "Start tracking a container",
            "POST /stop/{container_id}": "Stop tracking a container",
            "GET /results/{container_id}": "Get aggregated syscall results",
            "GET /results/{container_id}?hot=true": "Get top 10 hot files with read/write ratios",
            "GET /stats/{container_id}": "Get container tracking stats",
            "GET /containers": "List currently tracked containers",
            "GET /dashboard": "Web dashboard for hot files visualization",
        },
    }


@app.get("/dashboard")
async def dashboard():
    return FileResponse("static/index.html")


@app.post("/track/{container_id}", response_model=TrackResponse)
async def start_tracking(container_id: str):
    if tracker_manager.is_tracking(container_id):
        return TrackResponse(
            status="already_tracking",
            container_id=container_id,
            message=f"Container {container_id} is already being tracked",
        )

    success = tracker_manager.start_tracking(container_id)
    if not success:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to start tracking container {container_id}. "
            f"Make sure the container is running and accessible.",
        )

    return TrackResponse(
        status="started",
        container_id=container_id,
        message=f"Started tracking container {container_id}",
    )


@app.post("/stop/{container_id}", response_model=StopResponse)
async def stop_tracking(container_id: str):
    if not tracker_manager.is_tracking(container_id):
        raise HTTPException(
            status_code=404,
            detail=f"Container {container_id} is not being tracked",
        )

    success = tracker_manager.stop_tracking(container_id)
    if not success:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to stop tracking container {container_id}",
        )

    return StopResponse(
        status="stopped",
        container_id=container_id,
        message=f"Stopped tracking container {container_id}",
    )


@app.get("/results/{container_id}")
async def get_results(
    container_id: str,
    start_time: Optional[int] = Query(
        None, description="Start timestamp in nanoseconds",
    ),
    end_time: Optional[int] = Query(
        None, description="End timestamp in nanoseconds",
    ),
    hot: Optional[bool] = Query(
        False, description="Return top 10 hot files with read/write ratios",
    ),
):
    if hot:
        hot_files = tracker_manager.get_hot_files(container_id, start_time, end_time, limit=10)
        return HotFilesResponse(
            container_id=container_id,
            hot_files=[HotFile(**hf) for hf in hot_files],
            total_files=len(hot_files),
            start_time_ns=start_time,
            end_time_ns=end_time,
            generated_at=int(time.time_ns()),
        )

    results, lost_events = tracker_manager.get_results(container_id, start_time, end_time)

    aggregated = [
        AggregatedResult(**r) for r in results
    ]

    return ResultsResponse(
        container_id=container_id,
        results=aggregated,
        total_entries=len(aggregated),
        lost_events=lost_events,
        has_lost_events=lost_events > 0,
        start_time_ns=start_time,
        end_time_ns=end_time,
    )


@app.get("/stats/{container_id}", response_model=StatsResponse)
async def get_stats(container_id: str):
    stats = tracker_manager.get_stats(container_id)

    return StatsResponse(
        container_id=container_id,
        is_tracking=stats["is_tracking"],
        total_events=stats["total_events"],
        tracking_duration_ms=stats["tracking_duration_ms"],
        unique_processes=stats["unique_processes"],
        unique_files=stats["unique_files"],
        total_lost_events=stats.get("total_lost", 0),
        has_lost_events=stats.get("total_lost", 0) > 0,
    )


@app.get("/containers")
async def list_tracked_containers():
    containers = tracker_manager.list_tracking_containers()
    return {"tracking_containers": containers}


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
