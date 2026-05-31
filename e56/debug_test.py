import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.engine.data_handler import DataHandler
from backend.engine.backtest import BacktestEngine
from backend.strategies.ma_cross import MovingAverageCrossStrategy


def test_data_loading():
    print("测试数据加载...")
    dh = DataHandler()
    dh.load_csv("examples/AAPL.csv", "AAPL")
    
    df = dh.get_data("AAPL")
    print(f"数据行数: {len(df)}")
    print(f"前5行收盘价: {df['close'].head().tolist()}")
    print(f"后5行收盘价: {df['close'].tail().tolist()}")
    
    print("\n测试合并数据...")
    merged = dh.get_merged_data()
    print(f"合并后行数: {len(merged)}")
    print(f"前5行:")
    print(merged.head())
    
    return True


def test_market_events():
    print("\n测试市场事件生成...")
    engine = BacktestEngine()
    engine.load_data("examples/AAPL.csv", "AAPL")
    
    data = engine.data_handler.get_data("AAPL")
    print(f"数据加载成功，行数: {len(data)}")
    print(f"价格范围: {data['close'].min():.2f} - {data['close'].max():.2f}")
    
    return True


def test_strategy():
    print("\n测试策略...")
    engine = BacktestEngine()
    engine.load_data("examples/AAPL.csv", "AAPL")
    
    strategy = MovingAverageCrossStrategy(["AAPL"], 5, 20)
    engine.set_strategy(strategy)
    
    results = engine.run()
    
    print(f"回测结果:")
    print(f"  总收益率: {results['performance']['total_return']*100:.2f}%")
    print(f"  交易次数: {len(results['trades'])}")
    print(f"  前3笔交易:")
    for trade in results['trades'][:3]:
        ts = trade['timestamp'] if hasattr(trade['timestamp'], 'isoformat') else str(trade['timestamp'])
        print(f"    {ts}: {trade['quantity']}股 @ {trade['price']:.2f}")
    
    return True


if __name__ == "__main__":
    print("=" * 60)
    print("调试测试")
    print("=" * 60)
    
    test_data_loading()
    test_market_events()
    test_strategy()
    
    print("\n" + "=" * 60)
    print("调试完成")
    print("=" * 60)
