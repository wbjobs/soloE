import requests

BASE_URL = "http://localhost:8080"

print("=" * 60)
print("Testing Enhanced API Gateway")
print("=" * 60)

print("\n1. Testing Health Check...")
response = requests.get(f"{BASE_URL}/api/v1/health")
print(f"   Status: {response.status_code}")
print(f"   Response: {response.json()}")

print("\n" + "=" * 60)
print("2. Testing Query API with various questions")
print("=" * 60)

test_cases = [
    "上海地区上个月销售额最高的产品是什么？",
    "北京地区本月销量最多的产品是什么？",
    "今年销售额总和是多少？",
    "苹果品牌的产品在上海的销售情况",
]

for i, question in enumerate(test_cases, 1):
    print(f"\nTest {i}: {question}")
    response = requests.post(
        f"{BASE_URL}/api/v1/query",
        json={"question": question, "timeout_ms": 5000}
    )
    print(f"   Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"   Execution time: {data['execution_time_ms']}ms")
        print(f"   Intent: {data['logical_plan']['intent']}")
        print(f"   Involved tables: {data['logical_plan']['involved_tables']}")
        print(f"   Warnings ({len(data['warnings'])}):")
        for w in data['warnings']:
            print(f"     ⚠ {w}")
        print(f"   Sub-query results:")
        for qid, results in data['sub_query_results'].items():
            print(f"     {qid}: {len(results)} rows")
        print(f"   Final result ({len(data['final_result'])} rows):")
        for row in data['final_result'][:3]:
            print(f"     {row}")
    else:
        print(f"   Error: {response.text}")

print("\n" + "=" * 60)
print("3. Testing SQL Injection Protection (should be rejected)")
print("=" * 60)

malicious_questions = [
    "上海地区'; DROP TABLE sales--",
    "上海地区' OR '1'='1",
]

for question in malicious_questions:
    print(f"\nMalicious query: {question}")
    response = requests.post(
        f"{BASE_URL}/api/v1/query",
        json={"question": question}
    )
    print(f"   Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"   Warnings: {data['warnings']}")
        print(f"   Result rows: {len(data['final_result'])}")

print("\n" + "=" * 60)
print("All API tests completed!")
print("=" * 60)
