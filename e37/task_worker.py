import os
import sys
import importlib
import time
from datetime import datetime
from functools import wraps

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models import db, Task, TaskHistory, TaskStatus
from task_queue import redis_conn, get_queue
from config import Config

from flask import Flask
app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

def with_db_context(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        with app.app_context():
            return f(*args, **kwargs)
    return wrapper

def import_function(function_name):
    module_path, func_name = function_name.rsplit('.', 1)
    module = importlib.import_module(module_path)
    return getattr(module, func_name)

@with_db_context
def check_dependencies(task):
    if task.depends_on:
        parent_task = Task.query.get(task.depends_on)
        if parent_task and parent_task.status != TaskStatus.COMPLETED:
            return False
    return True

@with_db_context
def update_task_status(task_id, status, result=None, error_message=None, retry_count=None):
    task = Task.query.get(task_id)
    if not task:
        return
    
    task.status = status
    if result is not None:
        task.result = str(result)
    if error_message is not None:
        task.error_message = str(error_message)
    if retry_count is not None:
        task.retry_count = retry_count
    
    if status == TaskStatus.RUNNING:
        task.started_at = datetime.utcnow()
    elif status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
        task.completed_at = datetime.utcnow()
    
    history = TaskHistory(
        task_id=task_id,
        status=status,
        result=str(result) if result else None,
        error_message=str(error_message) if error_message else None,
        retry_number=task.retry_count
    )
    db.session.add(history)
    db.session.commit()

@with_db_context
def retry_task(task_id, function_name, args, kwargs):
    task = Task.query.get(task_id)
    if not task:
        return
    
    if task.retry_count < task.max_retries:
        retry_count = task.retry_count + 1
        delay = Config.RETRY_BACKOFF_BASE ** retry_count
        
        update_task_status(
            task_id,
            TaskStatus.QUEUED,
            retry_count=retry_count,
            error_message=f"Retrying in {delay} seconds..."
        )
        
        queue = get_queue(task.queue_name)
        queue.enqueue_in(
            time_delta=delay,
            func=execute_task_wrapper,
            args=(task_id, function_name),
            kwargs={
                'args': args,
                'kwargs': kwargs
            },
            job_id=f"{task_id}_retry_{retry_count}",
            job_timeout=task.timeout
        )
        return True
    return False

@with_db_context
def trigger_dependent_tasks(task_id):
    task = Task.query.get(task_id)
    if not task:
        return
    
    for dependent_task in task.dependent_tasks:
        if dependent_task.status == TaskStatus.PENDING:
            if check_dependencies(dependent_task):
                queue = get_queue(dependent_task.queue_name)
                queue.enqueue(
                    execute_task_wrapper,
                    dependent_task.id,
                    dependent_task.function_name,
                    args=dependent_task.function_args,
                    kwargs=dependent_task.function_kwargs,
                    job_id=dependent_task.id,
                    job_timeout=dependent_task.timeout
                )
                update_task_status(dependent_task.id, TaskStatus.QUEUED)

def execute_task_wrapper(task_id, function_name, args=None, kwargs=None):
    args = args or []
    kwargs = kwargs or {}
    
    with app.app_context():
        task = Task.query.get(task_id)
        if not task:
            return
        
        if task.status == TaskStatus.CANCELLED:
            return
        
        if not check_dependencies(task):
            return
    
    update_task_status(task_id, TaskStatus.RUNNING)
    
    try:
        func = import_function(function_name)
        result = func(*args, **kwargs)
        
        update_task_status(task_id, TaskStatus.COMPLETED, result=result)
        
        with app.app_context():
            trigger_dependent_tasks(task_id)
            
            from shard_task import on_shard_complete
            on_shard_complete(task_id, result)
        
        return result
        
    except Exception as e:
        error_message = str(e)
        
        if retry_task(task_id, function_name, args, kwargs):
            return
        
        update_task_status(task_id, TaskStatus.FAILED, error_message=error_message)
        
        with app.app_context():
            from shard_task import on_shard_complete
            on_shard_complete(task_id, None)
        
        raise

if __name__ == '__main__':
    print("Task worker module loaded")
