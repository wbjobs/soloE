import redis
from rq import Queue, Connection
from rq.job import Job
from rq_scheduler import Scheduler
from datetime import datetime
import importlib
import time
from config import Config

redis_conn = redis.from_url(Config.REDIS_URL)

def get_queues():
    return {
        'default': Queue('default', connection=redis_conn),
        'high': Queue('high', connection=redis_conn),
        'low': Queue('low', connection=redis_conn)
    }

def get_queue(queue_name='default'):
    queues = get_queues()
    return queues.get(queue_name, queues['default'])

def get_scheduler():
    return Scheduler(connection=redis_conn, queue_name='default')

def execute_task(function_name, *args, **kwargs):
    module_path, func_name = function_name.rsplit('.', 1)
    module = importlib.import_module(module_path)
    func = getattr(module, func_name)
    return func(*args, **kwargs)

def enqueue_task(task_id, function_name, queue_name='default', *args, **kwargs):
    queue = get_queue(queue_name)
    job = queue.enqueue(
        'task_worker.execute_task_wrapper',
        task_id,
        function_name,
        args=args,
        kwargs=kwargs,
        job_id=task_id,
        job_timeout=kwargs.get('timeout', Config.MAX_JOB_TIMEOUT)
    )
    return job

def schedule_cron_task(task_id, function_name, cron_expression, queue_name='default', *args, **kwargs):
    scheduler = get_scheduler()
    job = scheduler.cron(
        cron_expression,
        'task_worker.execute_task_wrapper',
        [task_id, function_name],
        kwargs={
            'args': args,
            'kwargs': kwargs
        },
        queue_name=queue_name,
        job_id=task_id
    )
    return job

def cancel_task(task_id):
    try:
        job = Job.fetch(task_id, connection=redis_conn)
        job.delete()
        return True
    except:
        pass
    
    scheduler = get_scheduler()
    for job in scheduler.get_jobs():
        if job.id == task_id:
            scheduler.cancel(job)
            return True
    return False

def get_job_status(task_id):
    try:
        job = Job.fetch(task_id, connection=redis_conn)
        return job.get_status()
    except:
        return None
