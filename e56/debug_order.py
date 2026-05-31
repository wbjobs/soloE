import sys
import os
import queue

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.engine.data_handler import DataHandler
from backend.engine.events import MarketEvent, EventType


def test_order():
    handler = DataHandler()
    data_path = os.path.join("examples", "AAPL.csv")
    handler.load_csv(data_path, "AAPL")
    
    event_queue: queue.Queue = queue.Queue()
    
    merged_data = handler.get_merged_data()
    
    print("把事件放入队列...")
    for i, (_, row) in enumerate(merged_data.iterrows()):
        event = MarketEvent(
            timestamp=row['timestamp'],
            symbol=row['symbol'],
            open=row['open'],
            high=row['high'],
            low=row['low'],
            close=row['close'],
            volume=row['volume']
        )
        event_queue.put(event)
        if i < 3:
            print(f"  放入事件{i}: {event.timestamp}, 价格: {event.close}")
    
    print(f"\n队列大小: {event_queue.qsize()}")
    
    print("\n从队列取出事件...")
    for i in range(3):
        event = event_queue.get()
        print(f"  取出事件{i}: {event.timestamp}, 价格: {event.close}")
    
    print("\n检查最后几个事件...")
    # 清空队列并检查最后几个
    last_events = []
    while not event_queue.empty():
        event = event_queue.get()
        last_events.append(event)
        if len(last_events) > 3:
            last_events.pop(0)
    
    for i, event in enumerate(last_events):
        print(f"  最后事件: {event.timestamp}, 价格: {event.close}")


if __name__ == "__main__":
    test_order()
