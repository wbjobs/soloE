import requests
import time

BASE_URL = 'http://localhost:5000/api'

def example_submit_task():
    print("1. 提交普通任务...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'name': 'Example Task',
        'function_name': 'tasks.example_task',
        'args': [10, 20],
        'queue_name': 'default'
    })
    task = response.json()
    print(f"   任务ID: {task['id']}")
    print(f"   状态: {task['status']}")
    return task['id']

def example_check_status(task_id):
    print(f"\n2. 检查任务状态...")
    response = requests.get(f'{BASE_URL}/tasks/{task_id}')
    task = response.json()
    print(f"   状态: {task['status']}")
    print(f"   结果: {task.get('result')}")

def example_dependent_tasks():
    print("\n3. 提交依赖任务...")
    
    response = requests.post(f'{BASE_URL}/tasks', json={
        'name': 'Task A - Process Data',
        'function_name': 'tasks.process_data',
        'args': [12345],
        'queue_name': 'default'
    })
    task_a = response.json()
    print(f"   任务A ID: {task_a['id']}")
    
    response = requests.post(f'{BASE_URL}/tasks', json={
        'name': 'Task B - Generate Report (depends on A)',
        'function_name': 'tasks.generate_report',
        'args': [12345],
        'depends_on': task_a['id'],
        'queue_name': 'default'
    })
    task_b = response.json()
    print(f"   任务B ID: {task_b['id']} (依赖任务A)")
    
    return task_a['id'], task_b['id']

def example_retry_task():
    print("\n4. 提交会失败并重试的任务...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'name': 'Flaky Task (with retry)',
        'function_name': 'tasks.flaky_task',
        'queue_name': 'default',
        'max_retries': 3
    })
    task = response.json()
    print(f"   任务ID: {task['id']}")
    return task['id']

def example_cron_task():
    print("\n5. 提交定时任务 (每分钟执行)...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'name': 'Scheduled Email Task',
        'function_name': 'tasks.send_email',
        'args': ['user@example.com', 'Scheduled Report', 'This is a scheduled email'],
        'cron_expression': '*/1 * * * *',
        'queue_name': 'default'
    })
    task = response.json()
    print(f"   任务ID: {task['id']}")
    return task['id']

def example_cancel_task(task_id):
    print(f"\n6. 取消任务...")
    response = requests.delete(f'{BASE_URL}/tasks/{task_id}')
    result = response.json()
    print(f"   结果: {result['message']}")

def example_task_history(task_id):
    print(f"\n7. 查看任务执行历史...")
    response = requests.get(f'{BASE_URL}/tasks/{task_id}/history')
    result = response.json()
    print(f"   历史记录数: {result['total']}")
    for h in result['history']:
        print(f"     - {h['execution_time']}: {h['status']}")

if __name__ == '__main__':
    print("=== 分布式任务调度系统示例 ===\n")
    
    task_id = example_submit_task()
    
    time.sleep(3)
    example_check_status(task_id)
    
    task_a_id, task_b_id = example_dependent_tasks()
    
    retry_task_id = example_retry_task()
    
    cron_task_id = example_cron_task()
    
    time.sleep(1)
    example_cancel_task(cron_task_id)
    
    time.sleep(5)
    example_task_history(task_id)
    
    print("\n=== 示例完成 ===")
    print("\n提示:")
    print("  - 确保Redis正在运行 (redis-server)")
    print("  - 确保PostgreSQL正在运行并创建了数据库")
    print("  - 启动Worker: rq worker --url redis://localhost:6379/0")
    print("  - 启动调度器: python scheduler.py")
    print("  - 启动API服务: python app.py")
