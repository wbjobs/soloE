import requests

# 测试: FC18 = -1000 = -10.0°C
print('Test 1: FC1801F403E8 (temp: -10.0°C)')
response = requests.post('http://localhost:5000/api/data', 
                         json={'payload': 'FC1801F403E8'})
print(response.json())

# 测试: FF9C = -100 = -1.0°C
print('\nTest 2: FF9C01F403E8 (temp: -1.0°C)')
response = requests.post('http://localhost:5000/api/data', 
                         json={'payload': 'FF9C01F403E8'})
print(response.json())

# 测试: 0BB8 = 3000 = 30.0°C (正数)
print('\nTest 3: 0BB801F403E8 (temp: 30.0°C)')
response = requests.post('http://localhost:5000/api/data', 
                         json={'payload': '0BB801F403E8'})
print(response.json())

# 获取所有数据验证
print('\n--- All data ---')
response = requests.get('http://localhost:5000/api/data')
for data in response.json():
    print(f"ID {data['id']}: {data['temperature']}°C, {data['humidity']}%, {data['pressure']}kPa")
