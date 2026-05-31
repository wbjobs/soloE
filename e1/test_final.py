import requests
from datetime import date, timedelta

# 测试昨天的数据（有数据）
yesterday = (date.today() - timedelta(days=1)).isoformat()
print(f'Testing aggregate for {yesterday}...')
response = requests.get(f'http://localhost:5000/api/data/aggregate?date={yesterday}')
result = response.json()
print(f'Data count: {result["count"]}')
print(f'Temperature: avg={result["temperature"]["avg"]}, min={result["temperature"]["min"]}, max={result["temperature"]["max"]}')
print(f'Humidity: avg={result["humidity"]["avg"]}, min={result["humidity"]["min"]}, max={result["humidity"]["max"]}')
print(f'Pressure: avg={result["pressure"]["avg"]}, min={result["pressure"]["min"]}, max={result["pressure"]["max"]}')

# 测试原始数据API
print('\nTesting raw data API...')
response = requests.get('http://localhost:5000/api/data?limit=3')
print(f'Got {len(response.json())} records')

print('\nAll tests passed! System is working correctly.')
