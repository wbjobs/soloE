import requests
import time
import json

BASE_URL = 'http://localhost:5000/api'

def test_sharded_sum_task():
    print("=== 测试分片任务（MapReduce）===\n")
    
    numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    
    print("1. 提交分片求和任务...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'sum_task_001',
        'name': 'Distributed Sum Task',
        'function_name': 'tasks.sum_shard',
        'is_sharded': True,
        'shard_function': 'tasks.shard_data',
        'merge_function': 'tasks.merge_shard_results',
        'kwargs': {
            'numbers': numbers,
            'shard_size': 2
        }
    })
    
    print(f"   状态码: {response.status_code}")
    if response.status_code == 201:
        result = response.json()
        print(f"   任务ID: {result['id']}")
        print(f"   分片数: {result['shard_count']}")
    else:
        print(f"   错误: {response.json()}")
        return
    
    print("\n2. 轮询查询任务进度...")
    for i in range(10):
        response = requests.get(f'{BASE_URL}/tasks/sum_task_001/progress')
        progress = response.json()
        
        print(f"   进度 {i+1}: {progress['progress_percent']}% "
              f"(完成: {progress['shard_completed']}/{progress['shard_count']}, "
              f"运行中: {progress['shard_running']}, "
              f"失败: {progress['shard_failed']})")
        
        if progress['status'] in ['completed', 'failed']:
            break
        
        time.sleep(1)
    
    print("\n3. 获取最终结果...")
    response = requests.get(f'{BASE_URL}/tasks/sum_task_001')
    result = response.json()
    
    print(f"   最终状态: {result['status']}")
    if result['result']:
        final_result = json.loads(result['result'])
        print(f"   汇总结果:")
        print(f"     - 总数: {final_result['total_count']}")
        print(f"     - 总和: {final_result['total_sum']}")
        print(f"     - 平均值: {final_result['overall_avg']}")
    
    print("\n=== 分片任务测试完成 ===")

def test_sharded_email_task():
    print("\n=== 测试分片邮件发送任务 ===\n")
    
    users = [f'user{i}@example.com' for i in range(1, 11)]
    
    print("1. 提交批量邮件分片任务...")
    response = requests.post(f'{BASE_URL}/tasks', json={
        'id': 'email_task_001',
        'name': 'Bulk Email Task',
        'function_name': 'tasks.send_bulk_emails',
        'is_sharded': True,
        'shard_function': 'tasks.shard_user_emails',
        'merge_function': 'tasks.merge_email_results',
        'kwargs': {
            'users': users,
            'subject': 'Newsletter',
            'body': 'Hello World!'
        }
    })
    
    print(f"   状态码: {response.status_code}")
    if response.status_code == 201:
        result = response.json()
        print(f"   任务ID: {result['id']}")
        print(f"   分片数: {result['shard_count']}")
    
    print("\n2. 等待任务完成并查询进度...")
    for i in range(10):
        response = requests.get(f'{BASE_URL}/tasks/email_task_001/progress')
        progress = response.json()
        
        print(f"   进度 {i+1}: {progress['progress_percent']}% "
              f"(完成: {progress['shard_completed']}/{progress['shard_count']})")
        
        if progress['status'] in ['completed', 'failed']:
            break
        
        time.sleep(1)
    
    print("\n3. 获取邮件发送结果...")
    response = requests.get(f'{BASE_URL}/tasks/email_task_001')
    result = response.json()
    
    print(f"   最终状态: {result['status']}")
    if result['result']:
        final_result = json.loads(result['result'])
        print(f"   发送邮件总数: {final_result['total_emails']}")
    
    print("\n=== 邮件分片任务测试完成 ===")

if __name__ == '__main__':
    test_sharded_sum_task()
    print("\n" + "="*60 + "\n")
    test_sharded_email_task()
