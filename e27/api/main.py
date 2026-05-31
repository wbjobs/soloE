import sys
import os
import threading
import queue

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from redis_utils import create_task, get_task, subscribe_task_stream

app = FastAPI(title="文本生成任务API", version="1.0.0")


class TaskRequest(BaseModel):
    prompt: str


class TaskResponse(BaseModel):
    task_id: str
    status: str
    result: str | None = None


@app.post("/tasks", response_model=TaskResponse)
def create_new_task(request: TaskRequest):
    task_id = create_task(request.prompt)
    task = get_task(task_id)
    return TaskResponse(**task)


@app.get("/tasks/{task_id}", response_model=TaskResponse)
def get_task_status(task_id: str):
    task = get_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return TaskResponse(**task)


@app.get("/tasks/{task_id}/stream")
async def stream_task_result(task_id: str):
    task = get_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task["status"] == "finished":
        def finished_generator():
            yield f"data: {task['result']}\n\n"
            yield "data: [DONE]\n\n"
        
        return StreamingResponse(finished_generator(), media_type="text/event-stream")
    
    result_queue = queue.Queue()
    
    def redis_listener():
        try:
            for message in subscribe_task_stream(task_id):
                result_queue.put(message)
                if message.get("is_done"):
                    break
        except Exception as e:
            result_queue.put({"content": f"Error: {str(e)}", "is_done": True})
    
    listener_thread = threading.Thread(target=redis_listener, daemon=True)
    listener_thread.start()
    
    def event_generator():
        while True:
            try:
                message = result_queue.get(timeout=30)
                if message.get("is_done"):
                    yield "data: [DONE]\n\n"
                    break
                if message.get("content"):
                    yield f"data: {message['content']}\n\n"
            except queue.Empty:
                yield "data: [DONE]\n\n"
                break
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/health")
def health_check():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
