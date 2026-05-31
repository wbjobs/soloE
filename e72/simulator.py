import random
import time
import requests
import json
import os

def generate_data():
    vibration_temp = round(random.uniform(25.0, 80.0), 2)
    rpm = round(random.uniform(1000.0, 3000.0), 2)
    return {
        "timestamp": int(time.time() * 1000),
        "vibration_temp": vibration_temp,
        "rpm": rpm
    }

def send_data(data, target_port):
    try:
        response = requests.post(
            f"http://localhost:{target_port}/api/data",
            headers={"Content-Type": "application/json"},
            data=json.dumps(data)
        )
        if response.status_code == 200:
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 数据发送成功: {data}")
        else:
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 数据发送失败: {response.status_code}")
    except Exception as e:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 发送异常: {str(e)}")

if __name__ == "__main__":
    target_port = os.environ.get('SIMULATOR_TARGET_PORT', '3000')
    print("Modbus RTU 设备模拟器启动...")
    print(f"目标端口: {target_port}")
    print("每隔2秒发送振动温度和转速数据到后端API")
    print("按 Ctrl+C 停止")
    try:
        while True:
            data = generate_data()
            send_data(data, target_port)
            time.sleep(2)
    except KeyboardInterrupt:
        print("\n模拟器停止运行")