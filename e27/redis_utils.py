import json
import uuid
import redis
from typing import Optional, Dict, Any, List, Iterator
from config import REDIS_HOST, REDIS_PORT, REDIS_DB, TASK_QUEUE_KEY, TASK_RESULT_PREFIX, PROCESSING_TASKS_KEY, TASK_STREAM_CHANNEL_PREFIX


def get_redis_client() -> redis.Redis:
    return redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)


def create_task(prompt: str) -> str:
    task_id = str(uuid.uuid4())
    task_data = {
        "task_id": task_id,
        "prompt": prompt,
        "status": "pending",
        "result": None
    }
    
    r = get_redis_client()
    r.rpush(TASK_QUEUE_KEY, json.dumps(task_data))
    r.set(f"{TASK_RESULT_PREFIX}{task_id}", json.dumps(task_data))
    
    return task_id


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    r = get_redis_client()
    task_data = r.get(f"{TASK_RESULT_PREFIX}{task_id}")
    
    if task_data:
        return json.loads(task_data)
    return None


def update_task_status(task_id: str, status: str, result: Optional[str] = None) -> None:
    r = get_redis_client()
    task_key = f"{TASK_RESULT_PREFIX}{task_id}"
    task_data = r.get(task_key)
    
    if task_data:
        task = json.loads(task_data)
        task["status"] = status
        if result is not None:
            task["result"] = result
        r.set(task_key, json.dumps(task))


def acquire_next_task() -> Optional[Dict[str, Any]]:
    r = get_redis_client()
    
    task_data = r.lpop(TASK_QUEUE_KEY)
    
    if task_data:
        task = json.loads(task_data)
        task_id = task["task_id"]
        
        r.rpush(PROCESSING_TASKS_KEY, json.dumps(task))
        
        update_task_status(task_id, "processing")
        
        return task
    
    return None


def complete_task(task_id: str, result: str) -> None:
    r = get_redis_client()
    
    update_task_status(task_id, "finished", result)
    
    processing_list = r.lrange(PROCESSING_TASKS_KEY, 0, -1)
    for task_json in processing_list:
        task = json.loads(task_json)
        if task["task_id"] == task_id:
            r.lrem(PROCESSING_TASKS_KEY, 1, task_json)
            break


def get_processing_tasks() -> List[Dict[str, Any]]:
    r = get_redis_client()
    processing_list = r.lrange(PROCESSING_TASKS_KEY, 0, -1)
    
    tasks = []
    for task_json in processing_list:
        task = json.loads(task_json)
        tasks.append(task)
    
    return tasks


def requeue_processing_task(task_id: str) -> None:
    r = get_redis_client()
    
    processing_list = r.lrange(PROCESSING_TASKS_KEY, 0, -1)
    target_task = None
    for task_json in processing_list:
        task = json.loads(task_json)
        if task["task_id"] == task_id:
            target_task = task
            r.lrem(PROCESSING_TASKS_KEY, 1, task_json)
            break
    
    if target_task:
        target_task["status"] = "pending"
        r.rpush(TASK_QUEUE_KEY, json.dumps(target_task))
        update_task_status(task_id, "pending")


def publish_task_stream(task_id: str, content: str, is_done: bool = False) -> None:
    r = get_redis_client()
    channel = f"{TASK_STREAM_CHANNEL_PREFIX}{task_id}"
    message = {
        "task_id": task_id,
        "content": content,
        "is_done": is_done
    }
    r.publish(channel, json.dumps(message))


def subscribe_task_stream(task_id: str) -> Iterator[Dict[str, Any]]:
    r = get_redis_client()
    channel = f"{TASK_STREAM_CHANNEL_PREFIX}{task_id}"
    pubsub = r.pubsub()
    pubsub.subscribe(channel)
    
    for message in pubsub.listen():
        if message["type"] == "message":
            yield json.loads(message["data"])
