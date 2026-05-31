import sys
sys.path.insert(0, '.')

from main import SessionLocal, TaskModel, parse_timestamp
from datetime import datetime

# 测试时间戳解析
test_ts = datetime.utcnow().isoformat()
print(f"测试时间戳: {test_ts}")
parsed = parse_timestamp(test_ts)
print(f"解析结果: {parsed}")
print(f"类型: {type(parsed)}")

# 测试数据库插入
db = SessionLocal()
try:
    # 创建测试任务
    test_task = TaskModel(
        task_id="test_task_123",
        task_name="test_task",
        status="SUCCESS",
        worker_name="worker-test",
        execution_time=1.5,
        queue_name="default",
        retries=0,
        timestamp=parsed
    )
    
    db.add(test_task)
    db.commit()
    print("✅ 数据插入成功！")
    
    # 查询数据
    tasks = db.query(TaskModel).all()
    print(f"数据库中共有 {len(tasks)} 条记录")
    
    for t in tasks:
        print(f"  - ID: {t.id}, task_id: {t.task_id}, status: {t.status}, time: {t.timestamp}")
        
except Exception as e:
    print(f"❌ 错误: {type(e).__name__}: {str(e)}")
    import traceback
    traceback.print_exc()
finally:
    db.close()
