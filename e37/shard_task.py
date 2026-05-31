import sys
import os
import importlib
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from models import db, Task, TaskStatus
from task_queue import get_queue

def import_function(function_name):
    if not function_name:
        return None
    module_path, func_name = function_name.rsplit('.', 1)
    module = importlib.import_module(module_path)
    return getattr(module, func_name)

def create_sharded_tasks(task_id, name, shard_function, function_kwargs, 
                         queue_name='default', max_retries=3, timeout=3600):
    shard_func = import_function(shard_function)
    if not shard_func:
        raise ValueError(f"Shard function {shard_function} not found")
    
    shard_args_list = shard_func(**function_kwargs)
    shard_count = len(shard_args_list)
    
    parent_task = Task.query.get(task_id)
    if parent_task:
        parent_task.is_sharded = True
        parent_task.shard_count = shard_count
        parent_task.shard_completed = 0
        db.session.commit()
    
    for idx, shard_args in enumerate(shard_args_list):
        shard_task_id = f"{task_id}_shard_{idx}"
        shard_task = Task(
            id=shard_task_id,
            name=f"{name} - Shard {idx}",
            function_name=parent_task.function_name,
            function_args=shard_args,
            function_kwargs={},
            queue_name=queue_name,
            max_retries=max_retries,
            timeout=timeout,
            shard_parent_id=task_id,
            shard_index=idx,
            status=TaskStatus.QUEUED
        )
        db.session.add(shard_task)
        
        queue = get_queue(queue_name)
        queue.enqueue(
            'task_worker.execute_task_wrapper',
            shard_task_id,
            parent_task.function_name,
            args=shard_args,
            kwargs={},
            job_id=shard_task_id,
            job_timeout=timeout
        )
    
    db.session.commit()
    return shard_count

def on_shard_complete(shard_task_id, result):
    shard_task = Task.query.get(shard_task_id)
    if not shard_task or not shard_task.shard_parent_id:
        return
    
    parent_task = Task.query.get(shard_task.shard_parent_id)
    if not parent_task:
        return
    
    parent_task.shard_completed += 1
    
    if parent_task.shard_completed >= parent_task.shard_count:
        all_shards = Task.query.filter_by(shard_parent_id=parent_task.id).all()
        
        failed_shards = [s for s in all_shards if s.status == TaskStatus.FAILED]
        if failed_shards:
            parent_task.status = TaskStatus.FAILED
            parent_task.error_message = f"{len(failed_shards)} shards failed"
            parent_task.completed_at = db.func.now()
        else:
            shard_results = []
            for shard in all_shards:
                try:
                    if shard.result:
                        shard_results.append(json.loads(shard.result))
                    else:
                        shard_results.append(None)
                except:
                    shard_results.append(shard.result)
            
            if parent_task.merge_function:
                try:
                    merge_func = import_function(parent_task.merge_function)
                    if merge_func:
                        final_result = merge_func(shard_results)
                        parent_task.result = json.dumps(final_result)
                    else:
                        parent_task.result = json.dumps(shard_results)
                except Exception as e:
                    parent_task.result = json.dumps(shard_results)
                    parent_task.error_message = f"Merge function failed: {str(e)}"
            else:
                parent_task.result = json.dumps(shard_results)
            
            parent_task.status = TaskStatus.COMPLETED
            parent_task.completed_at = db.func.now()
    
    db.session.commit()

def get_shard_progress(task_id):
    task = Task.query.get(task_id)
    if not task or not task.is_sharded:
        return None
    
    shards = Task.query.filter_by(shard_parent_id=task_id).all()
    
    completed = 0
    failed = 0
    running = 0
    pending = 0
    
    for shard in shards:
        if shard.status == TaskStatus.COMPLETED:
            completed += 1
        elif shard.status == TaskStatus.FAILED:
            failed += 1
        elif shard.status == TaskStatus.RUNNING:
            running += 1
        else:
            pending += 1
    
    progress = (completed / task.shard_count * 100) if task.shard_count > 0 else 0
    
    return {
        'task_id': task_id,
        'name': task.name,
        'status': task.status,
        'shard_count': task.shard_count,
        'shard_completed': completed,
        'shard_failed': failed,
        'shard_running': running,
        'shard_pending': pending,
        'progress_percent': round(progress, 2),
        'shards': [s.to_dict() for s in shards]
    }
