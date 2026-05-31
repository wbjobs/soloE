#!/usr/bin/env python3
import requests
import time
import random
from datetime import datetime

BACKEND_URL = "http://localhost:8000"

services = [
    ("nginx", 80),
    ("node", 3000),
    ("python", 8000),
    ("postgres", 5432),
    ("redis", 6379),
    ("mysql", 3306),
    ("elasticsearch", 9200),
    ("kafka", 9092),
    ("mongodb", 27017),
    ("rabbitmq", 5672),
    ("memcached", 11211),
    ("cassandra", 9042),
    ("zookeeper", 2181),
    ("hbase", 16000),
    ("spark", 7077),
    ("flink", 8081),
    ("tomcat", 8080),
    ("jetty", 9999),
    ("consul", 8500),
    ("etcd", 2379),
    ("prometheus", 9090),
    ("grafana", 3000),
    ("influxdb", 8086),
    ("telegraf", 8125),
    ("clickhouse", 8123),
    ("presto", 8080),
    ("hive", 10000),
    ("hadoop", 9000),
    ("yarn", 8088),
    ("mapreduce", 50030),
    ("dubbo", 20880),
    ("grpc", 50051),
    ("thrift", 9090),
    ("rest", 8080),
    ("graphql", 4000),
    ("websocket", 8080),
]

ips = [f"10.0.0.{i}" for i in range(1, 21)]
protocols = ["TCP", "UDP"]

error_prone_services = {"nginx", "python", "node", "mysql"}

def generate_mock_data():
    connections = []
    for _ in range(random.randint(20, 50)):
        src_idx = random.randint(0, len(services) - 1)
        dst_idx = random.randint(0, len(services) - 1)
        if src_idx == dst_idx:
            continue
            
        src_service, src_port = services[src_idx]
        dst_service, dst_port = services[dst_idx]
        
        count = random.randint(1, 100)
        
        error_count = 0
        if dst_service in error_prone_services and random.random() < 0.3:
            error_rate = random.uniform(0.05, 0.25)
            error_count = int(count * error_rate)
        
        connections.append({
            "src_ip": random.choice(ips),
            "src_port": src_port,
            "src_service": src_service,
            "src_pid": random.randint(1000, 9999),
            "dst_ip": random.choice(ips),
            "dst_port": dst_port,
            "dst_service": dst_service,
            "protocol": random.choice(protocols),
            "count": count,
            "error_count": error_count,
            "timestamp": time.time(),
        })
    return connections

def main():
    print("Starting mock data generator...")
    print(f"Backend URL: {BACKEND_URL}")
    
    try:
        while True:
            connections = generate_mock_data()
            try:
                response = requests.post(f"{BACKEND_URL}/api/connections", json=connections, timeout=5)
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Sent {len(connections)} connections, status: {response.status_code}")
            except Exception as e:
                print(f"Failed to send data: {e}")
            
            time.sleep(2)
    except KeyboardInterrupt:
        print("\nStopping mock data generator...")

if __name__ == "__main__":
    main()
