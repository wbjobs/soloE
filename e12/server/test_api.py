import requests
import time
from datetime import datetime

API_URL = "http://localhost:8000/api/v1/tasks"

# 模拟 collector 发送的数据
test_tasks = [
    {
        "task_id": f"test_{int(time.time() * 1000)}_1",
        "task_name": "send_email",
        "status": "SUCCESS",
        "worker_name": "worker-01",
        "execution_time": 2.5,
        "queue_name": "default",
        "retries": 0,
        "timestamp": datetime.utcnow().isoformat()
    },
    {
        "task_id": f"test_{int(time.time() * 1000)}_2",
        "task_name": "process_payment",
        "status": "FAILED",
        "worker_name": "worker-02",
        "execution_time": 5.2,
        "queue_name": "high_priority",
        "retries": 1,
        "timestamp": datetime.utcnow().isoformat()
    }
]

print(f"发送时间戳格式示例: {test_tasks[0]['timestamp']}")
print(f"发送 {len(test_tasks)} 条任务数据...")

try:
    response = requests.post(API_URL, json={"tasks": test_tasks}, timeout=5)
    print(f"响应状态码: {response.status_code}")
    print(f"响应内容: {response.json()}")
    
    if response.status_code == 201:
        print("\n✅ API 调用成功！")
        # 验证数据是否真的插入了
        get_response = requests.get(API_URL + "?limit=10", timeout=5)
        tasks = get_response.json()
        print(f"\n数据库中查询到 {len(tasks)} 条任务:")
        for t in tasks:
            print(f"  - {t['task_id']} | {t['status']} | {t['timestamp']}")
    else:
        print(f"❌ API 调用失败: {response.text}")
        
except Exception as e:
    print(f"❌ 错误: {type(e).__name__}: {str(e)}")
    import traceback
    traceback.print_exc()
