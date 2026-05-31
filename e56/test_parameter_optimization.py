import os
import sys
import shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.engine.parameter_optimizer import ParameterOptimizer


def prepare_test_data():
    """准备测试数据"""
    src_dir = os.path.join("examples")
    dst_dir = os.path.join("test_data")
    os.makedirs(dst_dir, exist_ok=True)
    
    for filename in os.listdir(src_dir):
        if filename.endswith('.csv'):
            shutil.copy2(os.path.join(src_dir, filename), 
                        os.path.join(dst_dir, filename))
    
    return dst_dir


def test_ma_cross_optimization():
    print("=" * 60)
    print("测试移动平均线策略参数优化")
    print("=" * 60)
    
    data_dir = prepare_test_data()
    
    optimizer = ParameterOptimizer(
        strategy_type="ma_cross",
        data_dir=data_dir
    )
    
    optimizer.add_parameter_range(
        name="short_window",
        min_value=5,
        max_value=15,
        step=5,
        value_type="int"
    )
    
    optimizer.add_parameter_range(
        name="long_window",
        min_value=20,
        max_value=40,
        step=10,
        value_type="int"
    )
    
    optimizer.set_optimization_metric("sharpe_ratio")
    
    param_combinations = optimizer.generate_parameter_combinations()
    print(f"生成参数组合: {len(param_combinations)} 个")
    print(f"参数组合示例: {param_combinations[:3]}")
    
    print("\n开始优化...")
    results = optimizer.run_optimization(
        symbols=["AAPL"],
        initial_capital=100000.0,
        max_workers=1
    )
    
    print(f"\n优化状态: {results['status']}")
    print(f"总测试组合数: {results['total_combinations']}")
    print(f"优化指标: {results['optimization_metric']}")
    
    print(f"\n最佳参数: {results['best_parameters']}")
    print("最佳表现:")
    perf = results['best_performance']
    print(f"  总收益率: {perf['total_return']*100:.2f}%")
    print(f"  夏普比率: {perf['sharpe_ratio']:.2f}")
    print(f"  最大回撤: {perf['max_drawdown']*100:.2f}%")
    print(f"  交易次数: {perf['total_trades']}")
    
    print(f"\n热力图数据可用: {results['heatmap_data']['available']}")
    if results['heatmap_data']['available']:
        print(f"  X轴: {results['heatmap_data']['x_axis']}")
        print(f"  Y轴: {results['heatmap_data']['y_axis']}")
        print(f"  X值: {results['heatmap_data']['x_values']}")
        print(f"  Y值: {results['heatmap_data']['y_values']}")
    
    shutil.rmtree(data_dir)
    return results['status'] == 'completed'


def test_rsi_optimization():
    print("\n" + "=" * 60)
    print("测试RSI策略参数优化")
    print("=" * 60)
    
    data_dir = prepare_test_data()
    
    optimizer = ParameterOptimizer(
        strategy_type="rsi",
        data_dir=data_dir
    )
    
    optimizer.add_parameter_range(
        name="period",
        min_value=10,
        max_value=20,
        step=5,
        value_type="int"
    )
    
    optimizer.add_parameter_range(
        name="overbought",
        min_value=70,
        max_value=80,
        step=5,
        value_type="float"
    )
    
    optimizer.add_parameter_range(
        name="oversold",
        min_value=20,
        max_value=30,
        step=5,
        value_type="float"
    )
    
    optimizer.set_optimization_metric("total_return")
    
    param_combinations = optimizer.generate_parameter_combinations()
    print(f"生成参数组合: {len(param_combinations)} 个")
    
    print("\n开始优化...")
    results = optimizer.run_optimization(
        symbols=["MSFT"],
        initial_capital=100000.0,
        max_workers=1
    )
    
    print(f"\n优化状态: {results['status']}")
    print(f"总测试组合数: {results['total_combinations']}")
    
    print(f"\n最佳参数: {results['best_parameters']}")
    print("最佳表现:")
    perf = results['best_performance']
    print(f"  总收益率: {perf['total_return']*100:.2f}%")
    print(f"  夏普比率: {perf['sharpe_ratio']:.2f}")
    print(f"  最大回撤: {perf['max_drawdown']*100:.2f}%")
    
    shutil.rmtree(data_dir)
    return results['status'] == 'completed'


def test_top_results():
    print("\n" + "=" * 60)
    print("测试获取Top结果")
    print("=" * 60)
    
    data_dir = prepare_test_data()
    
    optimizer = ParameterOptimizer(
        strategy_type="ma_cross",
        data_dir=data_dir
    )
    
    optimizer.add_parameter_range("short_window", 5, 15, 5)
    optimizer.add_parameter_range("long_window", 20, 50, 10)
    optimizer.set_optimization_metric("sharpe_ratio")
    
    results = optimizer.run_optimization(
        symbols=["AAPL"],
        max_workers=1
    )
    
    top5 = optimizer.get_top_results(5)
    print(f"\nTop 5 参数组合:")
    for i, result in enumerate(top5, 1):
        print(f"\n  {i}. 参数: {result['parameters']}")
        print(f"     总收益率: {result['performance']['total_return']*100:.2f}%")
        print(f"     夏普比率: {result['performance']['sharpe_ratio']:.2f}")
    
    shutil.rmtree(data_dir)
    return len(top5) > 0


def main():
    print("开始参数优化功能测试...\n")
    
    success_count = 0
    total_tests = 3
    
    try:
        if test_ma_cross_optimization():
            success_count += 1
    except Exception as e:
        print(f"MA策略优化测试失败: {e}")
        import traceback
        traceback.print_exc()
    
    try:
        if test_rsi_optimization():
            success_count += 1
    except Exception as e:
        print(f"RSI策略优化测试失败: {e}")
        import traceback
        traceback.print_exc()
    
    try:
        if test_top_results():
            success_count += 1
    except Exception as e:
        print(f"Top结果测试失败: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "=" * 60)
    print(f"测试结果: {success_count}/{total_tests} 通过")
    if success_count == total_tests:
        print("🎉 所有参数优化测试通过!")
    else:
        print("⚠️ 部分测试失败")
    print("=" * 60)


if __name__ == "__main__":
    main()
