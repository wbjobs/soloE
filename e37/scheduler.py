import time
import uuid
from datetime import datetime
from croniter import croniter
from datetime import datetime

from models import Task, TaskStatus
from task_queue import get_queue, redis_conn
from task_worker import app, db, execute_task_wrapper, update_task_status, check_dependencies

class CronScheduler:
    def __init__(self, sleep_interval=60):
        self.sleep_interval = sleep_interval
        self.running = False
    
    def should_run(self, cron_expression, base_time=None):
        base_time = base_time or datetime.utcnow()
        cron = croniter(cron_expression, base_time)
        next_run = cron.get_next(datetime)
        prev_run = cron.get_prev(datetime)
        
        time_diff = (base_time - prev_run).total_seconds()
        return time_diff < self.sleep_interval * 2
    
    def process_scheduled_tasks(self):
        with app.app_context():
            scheduled_tasks = Task.query.filter(
                Task.cron_expression.isnot(None),
                Task.status != TaskStatus.CANCELLED
            ).all()
            
            for task in scheduled_tasks:
                if self.should_run(task.cron_expression):
                    if check_dependencies(task):
                        job_id = f"{task.id}_{int(time.time())}"
                        
                        queue = get_queue(task.queue_name)
                        queue.enqueue(
                            execute_task_wrapper,
                            task.id,
                            task.function_name,
                            args=task.function_args,
                            kwargs=task.function_kwargs,
                            job_id=job_id,
                            job_timeout=task.timeout
                        )
                        
                        update_task_status(task.id, TaskStatus.QUEUED)
    
    def start(self):
        self.running = True
        print("Cron scheduler started...")
        while self.running:
            try:
                self.process_scheduled_tasks()
            except Exception as e:
                print(f"Error in scheduler: {e}")
            time.sleep(self.sleep_interval)
    
    def stop(self):
        self.running = False
        print("Cron scheduler stopped...")

def run_scheduler():
    scheduler = CronScheduler()
    scheduler.start()

if __name__ == '__main__':
    run_scheduler()
