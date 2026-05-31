from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from enum import Enum

db = SQLAlchemy()

class TaskStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class Task(db.Model):
    __tablename__ = 'tasks'
    
    id = db.Column(db.String(100), primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    function_name = db.Column(db.String(200), nullable=False)
    function_args = db.Column(db.JSON, default=list)
    function_kwargs = db.Column(db.JSON, default=dict)
    status = db.Column(db.String(50), default=TaskStatus.PENDING, index=True)
    queue_name = db.Column(db.String(100), default='default')
    
    cron_expression = db.Column(db.String(100), nullable=True)
    scheduled_time = db.Column(db.DateTime, nullable=True)
    
    depends_on = db.Column(db.String(100), db.ForeignKey('tasks.id'), nullable=True)
    
    max_retries = db.Column(db.Integer, default=3)
    retry_count = db.Column(db.Integer, default=0)
    timeout = db.Column(db.Integer, default=3600)
    
    result = db.Column(db.Text, nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    started_at = db.Column(db.DateTime, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    
    parent_task = db.relationship('Task', remote_side=[id], backref='dependent_tasks', foreign_keys=[depends_on])
    
    is_sharded = db.Column(db.Boolean, default=False)
    shard_count = db.Column(db.Integer, default=0)
    shard_completed = db.Column(db.Integer, default=0)
    shard_function = db.Column(db.String(200), nullable=True)
    merge_function = db.Column(db.String(200), nullable=True)
    shard_parent_id = db.Column(db.String(100), db.ForeignKey('tasks.id'), nullable=True)
    shard_index = db.Column(db.Integer, nullable=True)
    
    shard_parent = db.relationship('Task', remote_side=[id], backref='shards', foreign_keys=[shard_parent_id])
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'function_name': self.function_name,
            'function_args': self.function_args,
            'function_kwargs': self.function_kwargs,
            'status': self.status,
            'queue_name': self.queue_name,
            'cron_expression': self.cron_expression,
            'scheduled_time': self.scheduled_time.isoformat() if self.scheduled_time else None,
            'depends_on': self.depends_on,
            'max_retries': self.max_retries,
            'retry_count': self.retry_count,
            'timeout': self.timeout,
            'result': self.result,
            'error_message': self.error_message,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'is_sharded': self.is_sharded,
            'shard_count': self.shard_count,
            'shard_completed': self.shard_completed,
            'shard_function': self.shard_function,
            'merge_function': self.merge_function,
            'shard_parent_id': self.shard_parent_id,
            'shard_index': self.shard_index
        }

class TaskHistory(db.Model):
    __tablename__ = 'task_history'
    
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.String(100), db.ForeignKey('tasks.id'), nullable=False, index=True)
    status = db.Column(db.String(50), nullable=False)
    result = db.Column(db.Text, nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    execution_time = db.Column(db.DateTime, default=datetime.utcnow)
    retry_number = db.Column(db.Integer, default=0)
    worker_name = db.Column(db.String(200), nullable=True)
    
    task = db.relationship('Task', backref='history')
    
    def to_dict(self):
        return {
            'id': self.id,
            'task_id': self.task_id,
            'status': self.status,
            'result': self.result,
            'error_message': self.error_message,
            'execution_time': self.execution_time.isoformat() if self.execution_time else None,
            'retry_number': self.retry_number,
            'worker_name': self.worker_name
        }
