import argparse
import sys
from datetime import datetime, date
from sqlalchemy import func, distinct
from main import SessionLocal, TaskModel


def list_workers():
    db = SessionLocal()
    try:
        workers = db.query(distinct(TaskModel.worker_name)).all()
        worker_names = [w[0] for w in workers if w[0]]
        
        print("=" * 50)
        print("所有活跃过的 Worker")
        print("=" * 50)
        
        if not worker_names:
            print("暂无 worker 数据")
        else:
            for i, worker in enumerate(worker_names, 1):
                task_count = db.query(TaskModel).filter(
                    TaskModel.worker_name == worker
                ).count()
                print(f"{i:2d}. {worker:20s} (处理过 {task_count} 个任务)")
        print("=" * 50)
    finally:
        db.close()


def show_stats(target_date: str):
    db = SessionLocal()
    try:
        try:
            parsed_date = datetime.strptime(target_date, "%Y-%m-%d").date()
        except ValueError:
            print(f"错误: 日期格式 '{target_date}' 不正确，请使用 YYYY-MM-DD 格式")
            sys.exit(1)
        
        start_dt = datetime.combine(parsed_date, datetime.min.time())
        end_dt = datetime.combine(parsed_date, datetime.max.time())
        
        tasks = db.query(TaskModel).filter(
            TaskModel.timestamp >= start_dt,
            TaskModel.timestamp <= end_dt
        ).all()
        
        total_tasks = len(tasks)
        success_tasks = len([t for t in tasks if t.status == "SUCCESS"])
        failed_tasks = len([t for t in tasks if t.status == "FAILED"])
        
        avg_execution_time = 0
        if tasks:
            execution_times = [t.execution_time for t in tasks if t.execution_time]
            if execution_times:
                avg_execution_time = sum(execution_times) / len(execution_times)
        
        success_rate = (success_tasks / total_tasks * 100) if total_tasks > 0 else 0
        
        print("=" * 60)
        print(f"任务统计 - {target_date}")
        print("=" * 60)
        print(f"总任务数:      {total_tasks}")
        print(f"成功任务数:    {success_tasks}")
        print(f"失败任务数:    {failed_tasks}")
        print(f"任务成功率:    {success_rate:.2f}%")
        print(f"平均执行时间:  {avg_execution_time:.2f} 秒")
        print("=" * 60)
        
        if total_tasks == 0:
            print(f"提示: {target_date} 当天没有任务记录")
            
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(
        description="任务队列监控系统 - 命令行工具",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    subparsers = parser.add_subparsers(dest="command", help="可用命令")
    
    subparsers.add_parser("list-workers", help="列出所有活跃过的 worker 名称")
    
    stats_parser = subparsers.add_parser("stats", help="输出指定日期的任务统计")
    stats_parser.add_argument("--date", required=True, help="查询日期 (格式: YYYY-MM-DD)")
    
    args = parser.parse_args()
    
    if args.command is None:
        parser.print_help()
        sys.exit(0)
    
    if args.command == "list-workers":
        list_workers()
    elif args.command == "stats":
        show_stats(args.date)


if __name__ == "__main__":
    main()
