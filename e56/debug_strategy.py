import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.engine.data_handler import DataHandler
from backend.strategies.ma_cross import MovingAverageCrossStrategy
from backend.engine.events import MarketEvent


def test_strategy():
    handler = DataHandler()
    data_path = os.path.join("examples", "AAPL.csv")
    handler.load_csv(data_path, "AAPL")
    
    strategy = MovingAverageCrossStrategy(symbols=["AAPL"], short_window=5, long_window=20)
    
    merged_data = handler.get_merged_data()
    
    print("测试策略信号生成...")
    signals = []
    
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
        
        signal = strategy.calculate_signals(event)
        
        if signal and i > 30:
            signals.append((i, signal))
            print(f"第{i}行: {signal.signal_type}, 价格: {row['close']}")
    
    print(f"\n总信号数: {len(signals)}")


if __name__ == "__main__":
    test_strategy()
