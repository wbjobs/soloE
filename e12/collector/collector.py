import time
import json
import random
import schedule
import requests
from datetime import datetime
from typing import List, Dict

API_URL = "http://localhost:8000/api/v1/tasks"

TASK_NAMES = [
    "send_email",
    "process_payment",
    "generate_report",
    "sync_database",
    "resize_image",
    "send_notification",
    "process_order",
    "cleanup_temp_files"
]

WORKER_NAMES = [
    "worker-01",
    "worker-02",
    "worker-03",
    "worker-04"
]

STATUSES = ["SUCCESS", "FAILED", "PENDING", "RUNNING"]


def generate_task_data() -> List[Dict]:
    tasks = []
    num_tasks = random.randint(5, 15)
    
    for _ in range(num_tasks):
        task = {
            "task_id": f"task_{int(time.time() * 1000)}_{random.randint(1000, 9999)}",
            "task_name": random.choice(TASK_NAMES),
            "status": random.choices(STATUSES, weights=[60, 10, 15, 15])[0],
            "worker_name": random.choice(WORKER_NAMES),
            "execution_time": round(random.uniform(0.1, 30.0), 2),
            "queue_name": random.choice(["default", "high_priority", "low_priority"]),
            "retries": random.randint(0, 3),
            "timestamp": datetime.utcnow().isoformat()
        }
        tasks.append(task)
    
    return tasks


def send_data(tasks: List[Dict]):
    try:
        response = requests.post(API_URL, json={"tasks": tasks}, timeout=5)
        response.raise_for_status()
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
              f"Successfully sent {len(tasks)} tasks. Status: {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
              f"Failed to send data: {str(e)}")


def collect_and_send():
    tasks = generate_task_data()
    send_data(tasks)


def main():
    print("=" * 60)
    print("Distributed Task Queue Monitor - Collector")
    print("=" * 60)
    print(f"Sending data to: {API_URL}")
    print(f"Collection interval: 5 seconds")
    print("Press Ctrl+C to stop...")
    print("=" * 60)
    
    collect_and_send()
    
    schedule.every(5).seconds.do(collect_and_send)
    
    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nCollector stopped by user.")


if __name__ == "__main__":
    main()
