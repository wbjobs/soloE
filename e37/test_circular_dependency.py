import requests
import json

BASE_URL = 'http://localhost:5000/api'

def test_circular_dependency():
    print("=== 测试循环依赖检测 ===\n")
    
    print("1. 创建任务A，不依赖任何任务...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'task_a',
        'name': 'Task A',
        'function_name': 'tasks.example_task',
        'args': [1, 2]
    })
    print(f"   状态码: {response.status_code}")
    if response.status_code == 201:
        print(f"   ✅ 任务A创建成功")
    else:
        print(f"   ❌ 创建失败: {response.json()}")
    
    print("\n2. 创建任务B，依赖任务A...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'task_b',
        'name': 'Task B',
        'function_name': 'tasks.example_task',
        'args': [3, 4],
        'depends_on': 'task_a'
    })
    print(f"   状态码: {response.status_code}")
    if response.status_code == 201:
        print(f"   ✅ 任务B创建成功")
    else:
        print(f"   ❌ 创建失败: {response.json()}")
    
    print("\n3. 尝试创建任务C，依赖任务B...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'task_c',
        'name': 'Task C',
        'function_name': 'tasks.example_task',
        'args': [5, 6],
        'depends_on': 'task_b'
    })
    print(f"   状态码: {response.status_code}")
    if response.status_code == 201:
        print(f"   ✅ 任务C创建成功")
    else:
        print(f"   ❌ 创建失败: {response.json()}")
    
    print("\n4. 测试直接自依赖（任务依赖自己）...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'task_self',
        'name': 'Self Dependent Task',
        'function_name': 'tasks.example_task',
        'args': [7, 8],
        'depends_on': 'task_self'
    })
    print(f"   状态码: {response.status_code}")
    if response.status_code == 400:
        result = response.json()
        print(f"   ✅ 正确检测到自依赖")
        print(f"   错误信息: {result.get('error')}")
        print(f"   循环路径: {result.get('circular_path')}")
    else:
        print(f"   ❌ 未检测到自依赖")
    
    print("\n5. 测试双向依赖（A依赖B，B依赖A）...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'task_a2',
        'name': 'Task A2',
        'function_name': 'tasks.example_task',
        'args': [9, 10],
        'depends_on': 'task_b'
    })
    print(f"   状态码: {response.status_code}")
    if response.status_code == 201:
        print(f"   ✅ 任务A2创建成功（依赖B）")
    else:
        print(f"   ❌ 创建失败: {response.json()}")
    
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'task_b2',
        'name': 'Task B2',
        'function_name': 'tasks.example_task',
        'args': [11, 12],
        'depends_on': 'task_a2'
    })
    print(f"   状态码: {response.status_code}")
    if response.status_code == 400:
        result = response.json()
        print(f"   ✅ 正确检测到双向依赖")
        print(f"   错误信息: {result.get('error')}")
        print(f"   循环路径: {result.get('circular_path')}")
    else:
        print(f"   ❌ 未检测到双向依赖")
    
    print("\n6. 测试长链循环（A→B→C→A）...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'task_a3',
        'name': 'Task A3',
        'function_name': 'tasks.example_task',
        'args': [13, 14]
    })
    task_a3 = response.json()
    print(f"   任务A3创建成功")
    
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'task_b3',
        'name': 'Task B3',
        'function_name': 'tasks.example_task',
        'args': [15, 16],
        'depends_on': 'task_a3'
    })
    print(f"   任务B3创建成功")
    
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'task_c3',
        'name': 'Task C3',
        'function_name': 'tasks.example_task',
        'args': [17, 18],
        'depends_on': 'task_b3'
    })
    print(f"   任务C3创建成功")
    
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'task_a3',
        'name': 'Task A3 Updated',
        'function_name': 'tasks.example_task',
        'args': [19, 20],
        'depends_on': 'task_c3'
    })
    print(f"   状态码: {response.status_code}")
    
    print("\n=== 测试完成 ===")
    print("\n提示:")
    print("  - 请确保API服务正在运行 (python app.py)")
    print("  - 请确保PostgreSQL正在运行")

if __name__ == '__main__':
    test_circular_dependency()
