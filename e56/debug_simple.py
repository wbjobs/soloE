import sys
import os
import queue

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.engine.data_handler import DataHandler
from backend.engine.events import MarketEvent, SignalEvent, OrderEvent, FillEvent, EventType
from backend.strategies.ma_cross import MovingAverageCrossStrategy
from backend.engine.portfolio import Portfolio
from backend.engine.broker import Broker, SlippageModel, CommissionModel


def test_simple():
    handler = DataHandler()
    data_path = os.path.join("examples", "AAPL.csv")
    handler.load_csv(data_path, "AAPL")
    
    strategy = MovingAverageCrossStrategy(symbols=["AAPL"], short_window=5, long_window=20)
    
    slippage_model = SlippageModel('fixed', bps=5.0)
    commission_model = CommissionModel('percentage', rate=0.001, min=1.0)
    broker = Broker(slippage_model, commission_model)
    portfolio = Portfolio(100000.0)
    
    event_queue: queue.Queue = queue.Queue()
    
    merged_data = handler.get_merged_data()
    
    # 只放前50个事件到队列
    for _, row in merged_data.iterrows():
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
    
    print("开始逐步处理事件...")
    processed_events = 0
    while not event_queue.empty() and processed_events < 50:
        event = event_queue.get()
        
        if event.event_type == EventType.MARKET:
            processed_events += 1
            print(f"\n处理MarketEvent {processed_events}: {event.timestamp}, 价格: {event.close}")
            
            # 先更新价格
            portfolio.update_price(event.symbol, event.close, event.timestamp)
            print(f"  更新后current_prices: {portfolio.current_prices}")
            
            # 再计算信号
            signal = strategy.calculate_signals(event)
            if signal:
                print(f"  生成信号: {signal.signal_type}")
                event_queue.put(signal)
        
        elif event.event_type == EventType.SIGNAL:
            current_price = portfolio.current_prices.get(event.symbol, 0)
            print(f"\n处理SignalEvent: {event.timestamp}, {event.signal_type}, 当前价格: {current_price}")
            
            order = portfolio.generate_order(event, current_price)
            if order:
                print(f"  生成订单: {order.quantity}股")
                event_queue.put(order)


if __name__ == "__main__":
    test_simple()
