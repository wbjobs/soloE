import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.engine.backtest import BacktestEngine
from backend.strategies.ma_cross import MovingAverageCrossStrategy
from backend.strategies.rsi_strategy import RSIStrategy


def test_ma_cross_strategy():
    print("=" * 60)
    print("测试移动平均线金叉死叉策略")
    print("=" * 60)
    
    engine = BacktestEngine(
        initial_capital=100000.0,
        slippage_type="fixed",
        slippage_params={"bps": 5.0},
        commission_type="percentage",
        commission_params={"rate": 0.001, "min": 1.0}
    )
    
    data_path = os.path.join("examples", "AAPL.csv")
    if not engine.load_data(data_path, "AAPL"):
        print("❌ 加载数据失败")
        return False
    
    strategy = MovingAverageCrossStrategy(
        symbols=["AAPL"],
        short_window=5,
        long_window=20
    )
    engine.set_strategy(strategy)
    
    results = engine.run()
    perf = results["performance"]
    trades = results["trades"]
    
    print(f"✅ 总收益率: {perf['total_return']*100:.2f}%")
    print(f"✅ 最大回撤: {perf['max_drawdown']*100:.2f}%")
    print(f"✅ 年化收益率: {perf.get('annualized_return', 0)*100:.2f}%")
    print(f"✅ 夏普比率: {perf['sharpe_ratio']:.2f}")
    print(f"✅ 最终权益: ¥{perf['final_equity']:,.2f}")
    print(f"✅ 交易次数: {len(trades)}")
    
    if len(trades) > 0:
        print("\n前5笔交易:")
        for i, trade in enumerate(trades[:5]):
            print(f"  {i+1}. {trade['timestamp'].date()}: {'买入' if trade['quantity'] > 0 else '卖出'} "
                  f"{abs(trade['quantity'])}股 @ ¥{trade['price']:.2f}")
    
    return True


def test_rsi_strategy():
    print("\n" + "=" * 60)
    print("测试RSI策略")
    print("=" * 60)
    
    engine = BacktestEngine(
        initial_capital=100000.0,
        slippage_type="fixed",
        slippage_params={"bps": 5.0},
        commission_type="percentage",
        commission_params={"rate": 0.001, "min": 1.0}
    )
    
    data_path = os.path.join("examples", "MSFT.csv")
    if not engine.load_data(data_path, "MSFT"):
        print("❌ 加载数据失败")
        return False
    
    strategy = RSIStrategy(
        symbols=["MSFT"],
        period=14,
        overbought=70.0,
        oversold=30.0
    )
    engine.set_strategy(strategy)
    
    results = engine.run()
    perf = results["performance"]
    trades = results["trades"]
    
    print(f"✅ 总收益率: {perf['total_return']*100:.2f}%")
    print(f"✅ 最大回撤: {perf['max_drawdown']*100:.2f}%")
    print(f"✅ 年化收益率: {perf.get('annualized_return', 0)*100:.2f}%")
    print(f"✅ 夏普比率: {perf['sharpe_ratio']:.2f}")
    print(f"✅ 最终权益: ¥{perf['final_equity']:,.2f}")
    print(f"✅ 交易次数: {len(trades)}")
    
    return True


def test_multi_asset():
    print("\n" + "=" * 60)
    print("测试多资产组合回测")
    print("=" * 60)
    
    engine = BacktestEngine(
        initial_capital=100000.0,
        slippage_type="fixed",
        slippage_params={"bps": 5.0},
        commission_type="percentage",
        commission_params={"rate": 0.001, "min": 1.0}
    )
    
    for symbol in ["AAPL", "MSFT", "GOOG"]:
        data_path = os.path.join("examples", f"{symbol}.csv")
        if not engine.load_data(data_path, symbol):
            print(f"❌ 加载 {symbol} 数据失败")
            return False
    
    strategy = MovingAverageCrossStrategy(
        symbols=["AAPL", "MSFT", "GOOG"],
        short_window=5,
        long_window=20
    )
    engine.set_strategy(strategy)
    
    results = engine.run()
    perf = results["performance"]
    trades = results["trades"]
    
    print(f"✅ 回测股票: {', '.join(results['symbols'])}")
    print(f"✅ 总收益率: {perf['total_return']*100:.2f}%")
    print(f"✅ 最大回撤: {perf['max_drawdown']*100:.2f}%")
    print(f"✅ 年化收益率: {perf.get('annualized_return', 0)*100:.2f}%")
    print(f"✅ 夏普比率: {perf['sharpe_ratio']:.2f}")
    print(f"✅ 最终权益: ¥{perf['final_equity']:,.2f}")
    print(f"✅ 交易次数: {len(trades)}")
    
    return True


if __name__ == "__main__":
    print("开始测试回测系统...\n")
    
    success_count = 0
    total_tests = 3
    
    try:
        if test_ma_cross_strategy():
            success_count += 1
    except Exception as e:
        print(f"❌ MA策略测试失败: {e}")
        import traceback
        traceback.print_exc()
    
    try:
        if test_rsi_strategy():
            success_count += 1
    except Exception as e:
        print(f"❌ RSI策略测试失败: {e}")
        import traceback
        traceback.print_exc()
    
    try:
        if test_multi_asset():
            success_count += 1
    except Exception as e:
        print(f"❌ 多资产测试失败: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "=" * 60)
    print(f"测试结果: {success_count}/{total_tests} 通过")
    if success_count == total_tests:
        print("🎉 所有测试通过!")
    else:
        print("⚠️  部分测试失败")
