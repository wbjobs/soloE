import uuid
import threading
import time
from typing import Dict, Optional, Callable, Any
from datetime import datetime
from sqlalchemy.orm import Session
import base64
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'cli'))

from database import AsyncTask, Block, Image


class TaskManager:
    """
    轻量级异步任务管理器 - 基于线程池实现
    无需额外的Redis或消息队列，适合中小规模部署
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._tasks: Dict[str, threading.Thread] = {}
                    cls._instance._stop_event = threading.Event()
        return cls._instance

    def __init__(self):
        if not hasattr(self, '_initialized'):
            self._initialized = True

    def submit_task(self, db: Session, task_type: str, image_name: str,
                    func: Callable, *args, **kwargs) -> str:
        """
        提交异步任务

        Args:
            db: 数据库会话
            task_type: 任务类型
            image_name: 关联的镜像名称
            func: 要执行的函数
            *args: 函数参数
            **kwargs: 函数关键字参数

        Returns:
            任务ID
        """
        task_id = str(uuid.uuid4())

        task = AsyncTask(
            id=task_id,
            task_type=task_type,
            status="pending",
            image_name=image_name,
            progress=0,
            total=0,
        )
        db.add(task)
        db.commit()

        thread = threading.Thread(
            target=self._run_task,
            args=(task_id, func, args, kwargs),
            daemon=True
        )
        self._tasks[task_id] = thread
        thread.start()

        return task_id

    def _run_task(self, task_id: str, func: Callable, args: tuple, kwargs: dict):
        """执行任务的线程函数"""
        from database import SessionLocal

        db = SessionLocal()
        try:
            task = db.query(AsyncTask).filter(AsyncTask.id == task_id).first()
            if not task:
                return

            task.status = "running"
            task.updated_at = datetime.utcnow()
            db.commit()

            progress_callback = lambda current, total: self._update_progress(db, task_id, current, total)
            kwargs['progress_callback'] = progress_callback

            result = func(*args, **kwargs)

            task.status = "completed"
            task.progress = task.total if task.total > 0 else 100
            task.result = result
            task.updated_at = datetime.utcnow()
            db.commit()

        except Exception as e:
            task = db.query(AsyncTask).filter(AsyncTask.id == task_id).first()
            if task:
                task.status = "failed"
                task.error = str(e)
                task.updated_at = datetime.utcnow()
                db.commit()
        finally:
            db.close()
            if task_id in self._tasks:
                del self._tasks[task_id]

    def _update_progress(self, db: Session, task_id: str, current: int, total: int):
        """更新任务进度"""
        try:
            task = db.query(AsyncTask).filter(AsyncTask.id == task_id).first()
            if task:
                task.progress = current
                task.total = total
                task.updated_at = datetime.utcnow()
                db.commit()
        except Exception as e:
            pass

    def get_task_status(self, db: Session, task_id: str) -> Optional[Dict]:
        """获取任务状态"""
        task = db.query(AsyncTask).filter(AsyncTask.id == task_id).first()
        if not task:
            return None

        return {
            "task_id": task.id,
            "task_type": task.task_type,
            "status": task.status,
            "image_name": task.image_name,
            "progress": task.progress,
            "total": task.total,
            "message": task.message,
            "result": task.result,
            "error": task.error,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        }

    def list_tasks(self, db: Session, image_name: Optional[str] = None,
                   status: Optional[str] = None) -> list:
        """列出任务"""
        query = db.query(AsyncTask)

        if image_name:
            query = query.filter(AsyncTask.image_name == image_name)
        if status:
            query = query.filter(AsyncTask.status == status)

        tasks = query.order_by(AsyncTask.created_at.desc()).all()

        return [
            {
                "task_id": task.id,
                "task_type": task.task_type,
                "status": task.status,
                "image_name": task.image_name,
                "progress": task.progress,
                "total": task.total,
                "created_at": task.created_at.isoformat() if task.created_at else None,
                "updated_at": task.updated_at.isoformat() if task.updated_at else None,
            }
            for task in tasks
        ]

    def cleanup_completed(self, db: Session, older_than_hours: int = 24):
        """清理已完成的旧任务"""
        from datetime import timedelta
        cutoff = datetime.utcnow() - timedelta(hours=older_than_hours)
        db.query(AsyncTask).filter(
            AsyncTask.status.in_(["completed", "failed"]),
            AsyncTask.updated_at < cutoff
        ).delete()
        db.commit()


task_manager = TaskManager()
