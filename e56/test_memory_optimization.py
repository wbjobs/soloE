import os
import sys
import pandas as pd
import numpy as np
import time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.engine.backtest import BacktestEngine
from backend.strategies.ma_cross import MovingAverageCrossStrategy
from backend.engine.memory_monitor import get_memory_monitor


def generate_large_data(symbol: str, num_rows: int = 100000) -> str:
    print(f"正在生成 {num_rows} 条测试数据 ({symbol})...")
    
    base_date = datetime(2020, 1, 1)
    dates = [base_date + timedelta(minutes=i) for i in range(num_rows)]
    
    np.random.seed(42)
    base_price = 100.0
    returns = np.random.normal(0, 0.001, num_rows)
    prices = base_price * np.exp(np.cumsum(returns))
    
    highs = prices * (1 + np.random.uniform(0, 0.005, num_rows))
    lows = prices * (1 - np.random.uniform(0, 0.005, num_rows))
    opens = lows + np.random.uniform(0, 1, num_rows) * (highs - lows)
    closes = prices
    volumes = np.random.randint(100000, 1000000, num_rows)
    
    df = pd.DataFrame({
        'timestamp': dates,
        'open': opens,
        'high': highs,
        'low': lows,
        'close': closes,
        'volume': volumes
    })
    
    filename = f"large_{symbol}.csv"
    df.to_csv(filename, index=False)
    print(f"已保存到 {filename}")
    
    return filename


def test_standard_mode():
    print("\n" + "="*60)
    print("测试标准模式（全量加载）")
    print("="*60)
    
    file_path = generate_large_data("TEST1", 50000)
    
    monitor = get_memory_monitor()
    monitor.reset()
    
    engine = BacktestEngine(
        initial_capital=100000.0,
        use_streaming=False,
        enable_memory_monitoring=True
    )
    
    print("开始加载数据...")
    engine.load_data(file_path, "TEST1")
    
    mem_after_load = monitor.get_current_memory()
    print(f"数据加载后内存: {mem_after_load['rss_mb']:.2f} MB")
    
    strategy = MovingAverageCrossStrategy(
        symbols=["TEST1"],
        short_window=5,
        long_window=20
    )
    engine.set_strategy(strategy)
    
    print("开始回测...")
    start_time = time.time()
    results = engine.run()
    end_time = time.time()
    
    mem_stats = results['memory_stats']
    print(f"回测完成，耗时: {(end_time - start_time):.2f} 秒")
    print(f"峰值内存: {mem_stats['peak_rss_mb']:.2f} MB")
    print(f"当前内存: {mem_stats['current_rss_mb']:.2f} MB")
    print(f"收益率: {results['performance']['total_return']:.2%}")
    print(f"交易次数: {len(results['trades'])}")
    
    os.remove(file_path)
    
    return mem_stats['peak_rss_mb']


def test_streaming_mode():
    print("\n" + "="*60)
    print("测试流式模式（分块加载）")
    print("="*60)
    
    file_path = generate_large_data("TEST2", 50000)
    
    monitor = get_memory_monitor()
    monitor.reset()
    
    engine = BacktestEngine(
        initial_capital=100000.0,
        use_streaming=True,
        max_queue_size=1000,
        chunk_size=10000,
        enable_memory_monitoring=True
    )
    
    strategy = MovingAverageCrossStrategy(
        symbols=["TEST2"],
        short_window=5,
        long_window=20
    )
    engine.set_strategy(strategy)
    
    print("开始流式回测...")
    start_time = time.time()
    results = engine.run_streaming({"TEST2": file_path})
    end_time = time.time()
    
    mem_stats = results['memory_stats']
    print(f"回测完成，耗时: {(end_time - start_time):.2f} 秒")
    print(f"峰值内存: {mem_stats['peak_rss_mb']:.2f} MB")
    print(f"当前内存: {mem_stats['current_rss_mb']:.2f} MB")
    print(f"收益率: {results['performance']['total_return']:.2%}")
    print(f"交易次数: {len(results['trades'])}")
    
    os.remove(file_path)
    
    return mem_stats['peak_rss_mb']


def test_large_data_streaming():
    print("\n" + "="*60)
    print("测试超大数据流式加载 (10万条)")
    print("="*60)
    
    file_path = generate_large_data("TEST3", 100000)
    
    monitor = get_memory_monitor()
    monitor.reset()
    
    engine = BacktestEngine(
        initial_capital=100000.0,
        use_streaming=True,
        max_queue_size=1000,
        chunk_size=5000,
        enable_memory_monitoring=True
    )
    
    strategy = MovingAverageCrossStrategy(
        symbols=["TEST3"],
        short_window=5,
        long_window=20
    )
    engine.set_strategy(strategy)
    
    print("开始流式回测...")
    start_time = time.time()
    results = engine.run_streaming({"TEST3": file_path})
    end_time = time.time()
    
    mem_stats = results['memory_stats']
    print(f"回测完成，耗时: {(end_time - start_time):.2f} 秒")
    print(f"峰值内存: {mem_stats['peak_rss_mb']:.2f} MB")
    print(f"当前内存: {mem_stats['current_rss_mb']:.2f} MB")
    print(f"收益率: {results['performance']['total_return']:.2%}")
    print(f"交易次数: {len(results['trades'])}")
    
    os.remove(file_path)
    
    return mem_stats['peak_rss_mb']


def main():
    print("="*60)
    print("内存优化性能测试")
    print("="*60)
    
    gc = get_memory_monitor()
    gc.force_gc()
    
    standard_peak = test_standard_mode()
    gc.force_gc()
    time.sleep(1)
    
    streaming_peak = test_streaming_mode()
    gc.force_gc()
    time.sleep(1)
    
    large_streaming_peak = test_large_data_streaming()
    
    print("\n" + "="*60)
    print("测试结果总结")
    print("="*60)
    print(f"标准模式 (5万条) 峰值内存: {standard_peak:.2f} MB")
    print(f"流式模式 (5万条) 峰值内存: {streaming_peak:.2f} MB")
    print(f"流式模式 (10万条) 峰值内存: {large_streaming_peak:.2f} MB")
    print(f"内存优化率 (5万条): {((standard_peak - streaming_peak) / standard_peak * 100):.1f}%")
    print()
    print("✅ 内存优化测试完成!")
    print()


if __name__ == "__main__":
    main()
