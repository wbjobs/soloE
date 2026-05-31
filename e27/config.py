import os
from dotenv import load_dotenv

load_dotenv()

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_DB = int(os.getenv("REDIS_DB", 0))
TASK_QUEUE_KEY = "task_queue"
TASK_RESULT_PREFIX = "task_result:"
PROCESSING_TASKS_KEY = "processing_tasks"
TASK_STREAM_CHANNEL_PREFIX = "task_stream:"
