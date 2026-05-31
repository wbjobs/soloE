import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key')
    
    REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
    
    SQLALCHEMY_DATABASE_URI = (
        f"postgresql://{os.getenv('POSTGRES_USER', 'postgres')}:"
        f"{os.getenv('POSTGRES_PASSWORD', 'postgres')}@"
        f"{os.getenv('POSTGRES_HOST', 'localhost')}:"
        f"{os.getenv('POSTGRES_PORT', '5432')}/"
        f"{os.getenv('POSTGRES_DB', 'task_scheduler')}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    MAX_RETRIES = 3
    RETRY_BACKOFF_BASE = 2
    
    MAX_JOB_TIMEOUT = 3600
