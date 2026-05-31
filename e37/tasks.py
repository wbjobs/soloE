import time
import random

def example_task(x, y):
    time.sleep(1)
    return x + y

def long_running_task(seconds):
    time.sleep(seconds)
    return f"Task completed after {seconds} seconds"

def flaky_task():
    if random.random() < 0.7:
        raise Exception("Random failure occurred")
    return "Success!"

def send_email(recipient, subject, body):
    time.sleep(1)
    return f"Email sent to {recipient}: {subject}"

def process_data(data_id):
    time.sleep(2)
    return f"Data {data_id} processed successfully"

def generate_report(data_id):
    time.sleep(2)
    return f"Report generated for data {data_id}"

def shard_data(numbers, shard_size=2):
    shards = []
    for i in range(0, len(numbers), shard_size):
        shard = numbers[i:i + shard_size]
        shards.append([shard])
    return shards

def sum_shard(numbers):
    time.sleep(1)
    total = sum(numbers)
    return {
        'count': len(numbers),
        'sum': total,
        'avg': total / len(numbers) if numbers else 0
    }

def merge_shard_results(results):
    total_count = sum(r['count'] for r in results if r)
    total_sum = sum(r['sum'] for r in results if r)
    return {
        'total_count': total_count,
        'total_sum': total_sum,
        'overall_avg': total_sum / total_count if total_count > 0 else 0,
        'shard_results': results
    }

def shard_user_emails(users, subject, body):
    shards = []
    for i in range(0, len(users), 3):
        shard_users = users[i:i + 3]
        shards.append([shard_users, subject, body])
    return shards

def send_bulk_emails(recipients, subject, body):
    time.sleep(1)
    results = []
    for r in recipients:
        results.append(f"Email sent to {r}")
    return results

def merge_email_results(results):
    all_results = []
    for shard_result in results:
        if shard_result:
            all_results.extend(shard_result)
    return {
        'total_emails': len(all_results),
        'results': all_results
    }
