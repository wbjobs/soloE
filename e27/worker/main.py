import sys
import os
import time
import logging

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from redis_utils import acquire_next_task, complete_task, get_processing_tasks, requeue_processing_task, publish_task_stream

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def generate_text_result_stream(prompt: str, task_id: str) -> str:
    full_text = f"AI生成结果: 基于提示 '{prompt}' 生成的文本内容。这是模拟耗时操作后的流式输出结果。"
    
    for i, char in enumerate(full_text):
        publish_task_stream(task_id, char)
        time.sleep(0.05)
    
    publish_task_stream(task_id, "", is_done=True)
    
    return full_text


def recover_processing_tasks():
    processing_tasks = get_processing_tasks()
    
    if processing_tasks:
        logger.info(f"发现 {len(processing_tasks)} 个未完成的processing任务，正在重新入队...")
        
        for task in processing_tasks:
            task_id = task["task_id"]
            requeue_processing_task(task_id)
            logger.info(f"任务已重新入队: {task_id}")


def process_task():
    logger.info("工作进程启动，正在恢复中断的任务...")
    
    recover_processing_tasks()
    
    logger.info("等待新任务...")
    
    while True:
        task = acquire_next_task()
        
        if task:
            task_id = task["task_id"]
            prompt = task["prompt"]
            
            logger.info(f"开始处理任务: {task_id}")
            
            try:
                result = generate_text_result_stream(prompt, task_id)
                complete_task(task_id, result)
                
                logger.info(f"任务完成: {task_id}")
            except Exception as e:
                logger.error(f"任务处理出错 {task_id}: {str(e)}")
                requeue_processing_task(task_id)
                logger.info(f"任务已重新入队: {task_id}")
        else:
            time.sleep(1)


if __name__ == "__main__":
    process_task()
