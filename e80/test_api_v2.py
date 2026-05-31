import requests
import time

BASE_URL = "http://localhost:8080"

print("=" * 60)
print("Testing Enhanced API with Cache and Explain")
print("=" * 60)

print("\n1. Testing Health Check...")
response = requests.get(f"{BASE_URL}/api/v1/health")
print(f"   Status: {response.status_code}")
print(f"   Response: {response.json()}")

print("\n2. Testing Cache Clear...")
response = requests.post(f"{BASE_URL}/api/v1/cache/clear")
print(f"   Status: {response.status_code}")
print(f"   Response: {response.json()}")

print("\n" + "=" * 60)
print("3. Testing Query with Cache")
print("=" * 60)

question = "上海地区上个月销售额最高的产品是什么？"

print(f"\n第一次查询（缓存未命中）:")
start = time.time()
response = requests.post(
    f"{BASE_URL}/api/v1/query",
    json={"question": question}
)
print(f"   Status: {response.status_code}")
data = response.json()
print(f"   耗时: {data['execution_time_ms']}ms")
print(f"   警告: {data['warnings']}")
print(f"   结果行数: {len(data['final_result'])}")

print(f"\n第二次查询（应该缓存命中，速度更快）:")
start = time.time()
response = requests.post(
    f"{BASE_URL}/api/v1/query",
    json={"question": question}
)
print(f"   Status: {response.status_code}")
data = response.json()
print(f"   耗时: {data['execution_time_ms']}ms")
print(f"   警告: {data['warnings']}")
print(f"   结果行数: {len(data['final_result'])}")

print(f"\n第三次查询（绕过缓存）:")
start = time.time()
response = requests.post(
    f"{BASE_URL}/api/v1/query",
    json={"question": question, "bypass_cache": True}
)
print(f"   Status: {response.status_code}")
data = response.json()
print(f"   耗时: {data['execution_time_ms']}ms")
print(f"   警告: {data['warnings']}")
print(f"   结果行数: {len(data['final_result'])}")

print("\n4. Testing Cache Stats...")
response = requests.get(f"{BASE_URL}/api/v1/cache/stats")
print(f"   Status: {response.status_code}")
print(f"   Response: {response.json()}")

print("\n" + "=" * 60)
print("5. Testing Explain Interface")
print("=" * 60)

explain_question = "上海地区上个月销售额最高的产品是什么？"
print(f"\nExplain query: {explain_question}")
response = requests.post(
    f"{BASE_URL}/api/v1/explain",
    json={"question": explain_question}
)
print(f"   Status: {response.status_code}")
if response.status_code == 200:
    data = response.json()
    print(f"   Intent: {data['intent']}")
    print(f"   涉及表: {data['involved_tables']}")
    print(f"   解析耗时: {data['parse_time_ms']}ms")
    print(f"   执行耗时: {data['execution_time_ms']}ms")
    print(f"   总耗时: {data['total_time_ms']}ms")
    print(f"   子查询 ({len(data['sub_queries'])}):")
    for sq in data['sub_queries']:
        print(f"     - {sq['query_id']} ({sq['table_name']}@{sq['data_source']})")
        print(f"       选择列: {sq['select_columns']}")
        print(f"       结果行数: {sq['row_count']}")
        if sq['filters']:
            print(f"       过滤条件: {sq['filters']}")
    print(f"   结果行数: {data['result_row_count']}")
    if data['sample_results']:
        print(f"   示例结果:")
        for row in data['sample_results']:
            print(f"     {row}")

print("\n" + "=" * 60)
print("All tests completed!")
print("=" * 60)
