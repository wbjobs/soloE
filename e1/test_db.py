import sqlite3
from datetime import datetime, timedelta

conn = sqlite3.connect('backend/sensor_data.db')
cursor = conn.cursor()

# 查询所有表
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
print('Tables:', cursor.fetchall())

# 查询所有数据
cursor.execute('SELECT id, timestamp, temperature FROM sensor_data ORDER BY id DESC LIMIT 10')
rows = cursor.fetchall()
print('Latest 10 records:')
for row in rows:
    print(f'  ID: {row[0]}, Time: {row[1]}, Temp: {row[2]}')

# 测试今天的范围
today = datetime.now().date()
start_time = datetime.combine(today, datetime.min.time())
end_time = datetime.combine(today, datetime.max.time())
print(f'\nToday: {today}')
print(f'Start time: {start_time}')
print(f'End time: {end_time}')

# 看看有多少条数据是今天的
cursor.execute('SELECT COUNT(*) FROM sensor_data')
print(f'Total records: {cursor.fetchone()[0]}')

conn.close()
