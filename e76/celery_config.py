import os

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

broker_url = REDIS_URL
result_backend = REDIS_URL

task_serializer = "json"
result_serializer = "json"
accept_content = ["json"]
timezone = "Asia/Shanghai"
enable_utc = True

task_track_started = True
task_time_limit = 30 * 60
task_soft_time_limit = 25 * 60

worker_prefetch_multiplier = 1
worker_max_tasks_per_child = 1000
