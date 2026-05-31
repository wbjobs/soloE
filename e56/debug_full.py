import sys
import os
import queue

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.engine.data_handler import DataHandler
from backend.engine.events import MarketEvent, SignalEvent, OrderEvent, FillEvent, EventType
from backend.strategies.ma_cross import MovingAverageCrossStrategy
from backend.engine.portfolio import Portfolio
from backend.engine.broker import Broker, SlippageModel, CommissionModel


def test_full():
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
    
    print("开始回测...\n")
    trade_count = 0
    
    while not event_queue.empty():
        event = event_queue.get()
        
        if event.event_type == EventType.MARKET:
            portfolio.update_price(event.symbol, event.close, event.timestamp)
            signal = strategy.calculate_signals(event)
            if signal:
                event_queue.put(signal)
        
        elif event.event_type == EventType.SIGNAL:
            current_price = portfolio.current_prices.get(event.symbol, 0)
            print(f"[信号] {event.timestamp} {event.signal_type}, 当前价格: {current_price}")
            
            order = portfolio.generate_order(event, current_price)
            if order:
                print(f"  [订单] {event.timestamp}: {order.quantity}股, 价格: {current_price}")
                event_queue.put(order)
        
        elif event.event_type == EventType.ORDER:
            current_price = portfolio.current_prices.get(event.symbol, 0)
            fill = broker.execute_order(event, current_price)
            if fill:
                print(f"  [成交] {event.timestamp}: {fill.quantity}股 @ {fill.price:.2f}, "
                      f"手续费: {fill.commission:.2f}")
                portfolio.execute_fill(fill)
                trade_count += 1
    
    print(f"\n总成交数: {trade_count}")
    print(f"最终现金: {portfolio.current_capital:.2f}")
    
    positions = portfolio.get_current_positions()
    print(f"持仓: {positions}")
    
    total_value = portfolio.current_capital
    for symbol, pos in positions.items():
        total_value += pos.market_value
    
    print(f"总资产: {total_value:.2f}")
    print(f"收益率: {(total_value - 100000) / 100000 * 100:.2f}%")


if __name__ == "__main__":
    test_full()
