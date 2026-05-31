import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy

from config import Config
from models import db, Task, TaskHistory, TaskStatus
from task_queue import get_queue, cancel_task as cancel_rq_task
from task_worker import execute_task_wrapper, update_task_status, check_dependencies

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

with app.app_context():
    db.create_all()

def detect_circular_dependency(task_id, depends_on, path=None):
    if path is None:
        path = [task_id]
    
    if not depends_on:
        return None
    
    if depends_on == task_id:
        return path + [depends_on]
    
    if depends_on in path:
        return path + [depends_on]
    
    parent_task = Task.query.get(depends_on)
    if parent_task and parent_task.depends_on:
        new_path = path + [depends_on]
        result = detect_circular_dependency(task_id, parent_task.depends_on, new_path)
        if result:
            return result
    
    return None

@app.route('/api/tasks', methods=['POST'])
def submit_task():
    data = request.get_json()
    
    task_id = data.get('id', str(uuid.uuid4()))
    name = data.get('name', 'Unnamed Task')
    function_name = data.get('function_name')
    function_args = data.get('args', [])
    function_kwargs = data.get('kwargs', {})
    queue_name = data.get('queue_name', 'default')
    cron_expression = data.get('cron_expression')
    depends_on = data.get('depends_on')
    max_retries = data.get('max_retries', 3)
    timeout = data.get('timeout', 3600)
    
    if not function_name:
        return jsonify({'error': 'function_name is required'}), 400
    
    if depends_on:
        parent_task = Task.query.get(depends_on)
        if not parent_task:
            return jsonify({
                'error': 'Parent task not found',
                'parent_task_id': depends_on
            }), 400
        
        circular_path = detect_circular_dependency(task_id, depends_on)
        if circular_path:
            path_str = ' → '.join(circular_path)
            return jsonify({
                'error': 'Circular dependency detected',
                'circular_path': circular_path,
                'message': f'Task dependency chain forms a cycle: {path_str}'
            }), 400
    
    is_sharded = data.get('is_sharded', False)
    shard_function = data.get('shard_function')
    merge_function = data.get('merge_function')
    
    task = Task(
        id=task_id,
        name=name,
        function_name=function_name,
        function_args=function_args,
        function_kwargs=function_kwargs,
        queue_name=queue_name,
        cron_expression=cron_expression,
        depends_on=depends_on,
        max_retries=max_retries,
        timeout=timeout,
        is_sharded=is_sharded,
        shard_function=shard_function,
        merge_function=merge_function
    )
    
    db.session.add(task)
    db.session.commit()
    
    if not cron_expression:
        if is_sharded and shard_function:
            from shard_task import create_sharded_tasks
            try:
                shard_count = create_sharded_tasks(
                    task_id, name, shard_function, function_kwargs,
                    queue_name, max_retries, timeout
                )
                task.status = TaskStatus.RUNNING
                db.session.commit()
            except Exception as e:
                task.status = TaskStatus.FAILED
                task.error_message = f"Shard creation failed: {str(e)}"
                db.session.commit()
                return jsonify({
                    'error': 'Failed to create shards',
                    'message': str(e)
                }), 400
        elif depends_on:
            parent_task = Task.query.get(depends_on)
            if parent_task and parent_task.status == TaskStatus.COMPLETED:
                queue = get_queue(queue_name)
                queue.enqueue(
                    execute_task_wrapper,
                    task_id,
                    function_name,
                    args=function_args,
                    kwargs=function_kwargs,
                    job_id=task_id,
                    job_timeout=timeout
                )
                task.status = TaskStatus.QUEUED
                db.session.commit()
        else:
            queue = get_queue(queue_name)
            queue.enqueue(
                execute_task_wrapper,
                task_id,
                function_name,
                args=function_args,
                kwargs=function_kwargs,
                job_id=task_id,
                job_timeout=timeout
            )
            task.status = TaskStatus.QUEUED
            db.session.commit()
    
    return jsonify(task.to_dict()), 201

@app.route('/api/tasks/<task_id>', methods=['GET'])
def get_task_status(task_id):
    task = Task.query.get(task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    
    if task.is_sharded:
        from shard_task import get_shard_progress
        progress = get_shard_progress(task_id)
        return jsonify(progress)
    
    return jsonify(task.to_dict())

@app.route('/api/tasks/<task_id>/progress', methods=['GET'])
def get_task_progress(task_id):
    task = Task.query.get(task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    
    if task.is_sharded:
        from shard_task import get_shard_progress
        progress = get_shard_progress(task_id)
        return jsonify(progress)
    
    return jsonify({
        'task_id': task_id,
        'name': task.name,
        'status': task.status,
        'progress_percent': 100 if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED] else 0
    })

@app.route('/api/tasks/<task_id>', methods=['DELETE'])
def cancel_task_endpoint(task_id):
    task = Task.query.get(task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    
    if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
        return jsonify({'error': 'Task is already finished'}), 400
    
    if task.is_sharded:
        shards = Task.query.filter_by(shard_parent_id=task_id).all()
        for shard in shards:
            if shard.status not in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
                cancel_rq_task(shard.id)
                shard.status = TaskStatus.CANCELLED
                shard.completed_at = datetime.utcnow()
                
                history = TaskHistory(
                    task_id=shard.id,
                    status=TaskStatus.CANCELLED,
                    error_message='Shard cancelled due to parent task cancellation'
                )
                db.session.add(history)
    
    cancel_rq_task(task_id)
    
    task.status = TaskStatus.CANCELLED
    task.completed_at = datetime.utcnow()
    
    history = TaskHistory(
        task_id=task_id,
        status=TaskStatus.CANCELLED,
        error_message='Task cancelled by user'
    )
    db.session.add(history)
    db.session.commit()
    
    return jsonify({'message': 'Task cancelled successfully', 'task': task.to_dict()})

@app.route('/api/tasks/<task_id>/history', methods=['GET'])
def get_task_history(task_id):
    task = Task.query.get(task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    
    history_query = TaskHistory.query.filter_by(task_id=task_id).order_by(TaskHistory.execution_time.desc())
    pagination = history_query.paginate(page=page, per_page=per_page, error_out=False)
    
    return jsonify({
        'task_id': task_id,
        'history': [h.to_dict() for h in pagination.items],
        'total': pagination.total,
        'page': page,
        'per_page': per_page,
        'pages': pagination.pages
    })

@app.route('/api/tasks', methods=['GET'])
def list_tasks():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    status = request.args.get('status')
    
    query = Task.query.order_by(Task.created_at.desc())
    
    if status:
        query = query.filter_by(status=status)
    
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    
    return jsonify({
        'tasks': [t.to_dict() for t in pagination.items],
        'total': pagination.total,
        'page': page,
        'per_page': per_page,
        'pages': pagination.pages
    })

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
