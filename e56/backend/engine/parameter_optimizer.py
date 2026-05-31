import itertools
import multiprocessing as mp
from typing import Dict, List, Any, Optional, Tuple, Callable
from dataclasses import dataclass, field
from datetime import datetime
import numpy as np
import pandas as pd
import copy
import os

from .backtest import BacktestEngine
from ..strategies.ma_cross import MovingAverageCrossStrategy
from ..strategies.rsi_strategy import RSIStrategy


@dataclass
class ParameterRange:
    name: str
    min_value: float
    max_value: float
    step: float = 1.0
    value_type: str = "int"
    
    def generate_values(self) -> List[Any]:
        values = []
        current = self.min_value
        while current <= self.max_value:
            if self.value_type == "int":
                values.append(int(current))
            else:
                values.append(float(current))
            current += self.step
        return values


@dataclass
class OptimizationResult:
    parameters: Dict[str, Any]
    total_return: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    total_trades: int
    final_equity: float
    annualized_return: float
    execution_time: float = 0.0


def _single_backtest_worker(args: Tuple[Dict[str, Any], Dict[str, Any], str, List[str], str]) -> Optional[Dict[str, Any]]:
    """单进程回测工作函数（必须在模块级才能被pickle）"""
    try:
        params, config, strategy_type, symbols, data_dir = args
        start_time = datetime.now()
        
        engine = BacktestEngine(
            initial_capital=config.get('initial_capital', 100000.0),
            slippage_type=config.get('slippage_type', 'fixed'),
            slippage_params=config.get('slippage_params', {'bps': 5.0}),
            commission_type=config.get('commission_type', 'percentage'),
            commission_params=config.get('commission_params', {'rate': 0.001, 'min': 1.0}),
            enable_memory_monitoring=False
        )
        
        for symbol in symbols:
            file_path = os.path.join(data_dir, f"{symbol}.csv")
            if not os.path.exists(file_path):
                return None
            engine.load_data(file_path, symbol)
        
        if strategy_type == "ma_cross":
            strategy = MovingAverageCrossStrategy(
                symbols=symbols,
                short_window=params.get('short_window', 5),
                long_window=params.get('long_window', 20)
            )
        elif strategy_type == "rsi":
            strategy = RSIStrategy(
                symbols=symbols,
                period=params.get('period', 14),
                overbought=params.get('overbought', 70.0),
                oversold=params.get('oversold', 30.0)
            )
        else:
            return None
        
        engine.set_strategy(strategy)
        results = engine.run()
        
        execution_time = (datetime.now() - start_time).total_seconds()
        perf = results['performance']
        
        return {
            'parameters': params,
            'total_return': perf.get('total_return', 0.0),
            'sharpe_ratio': perf.get('sharpe_ratio', 0.0),
            'max_drawdown': perf.get('max_drawdown', 0.0),
            'win_rate': perf.get('win_rate', 0.0),
            'total_trades': len(results.get('trades', [])),
            'final_equity': perf.get('final_equity', 0.0),
            'annualized_return': perf.get('annualized_return', 0.0),
            'execution_time': execution_time
        }
    except Exception as e:
        print(f"回测执行错误: {e}")
        return None


class ParameterOptimizer:
    def __init__(self, strategy_type: str, data_dir: str):
        self.strategy_type = strategy_type
        self.data_dir = data_dir
        self.parameter_ranges: List[ParameterRange] = []
        self.results: List[OptimizationResult] = []
        self.best_result: Optional[OptimizationResult] = None
        self.optimization_metric: str = "sharpe_ratio"
        self._processes = max(1, mp.cpu_count() - 1)
    
    def add_parameter_range(self, name: str, min_value: float, max_value: float, 
                           step: float = 1.0, value_type: str = "int"):
        param_range = ParameterRange(
            name=name,
            min_value=min_value,
            max_value=max_value,
            step=step,
            value_type=value_type
        )
        self.parameter_ranges.append(param_range)
    
    def generate_parameter_combinations(self) -> List[Dict[str, Any]]:
        if not self.parameter_ranges:
            return [{}]
        
        param_names = [p.name for p in self.parameter_ranges]
        param_values_list = [p.generate_values() for p in self.parameter_ranges]
        
        combinations = []
        for values in itertools.product(*param_values_list):
            combinations.append(dict(zip(param_names, values)))
        
        return combinations
    
    def set_optimization_metric(self, metric: str):
        valid_metrics = ["sharpe_ratio", "total_return", "win_rate", 
                        "max_drawdown", "annualized_return"]
        if metric not in valid_metrics:
            raise ValueError(f"无效的优化指标: {metric}, 可选: {valid_metrics}")
        self.optimization_metric = metric
    
    def run_optimization(self, symbols: List[str], 
                        initial_capital: float = 100000.0,
                        slippage_type: str = "fixed",
                        slippage_params: Dict[str, Any] = None,
                        commission_type: str = "percentage",
                        commission_params: Dict[str, Any] = None,
                        max_workers: int = None,
                        progress_callback: Optional[Callable[[int, int], None]] = None) -> Dict[str, Any]:
        if slippage_params is None:
            slippage_params = {'bps': 5.0}
        if commission_params is None:
            commission_params = {'rate': 0.001, 'min': 1.0}
        
        config = {
            'initial_capital': initial_capital,
            'slippage_type': slippage_type,
            'slippage_params': slippage_params,
            'commission_type': commission_type,
            'commission_params': commission_params
        }
        
        param_combinations = self.generate_parameter_combinations()
        total_combinations = len(param_combinations)
        
        if total_combinations == 0:
            raise ValueError("没有生成参数组合")
        
        workers = max_workers if max_workers else self._processes
        workers = min(workers, total_combinations)
        
        print(f"开始参数优化: {total_combinations} 个参数组合, 使用 {workers} 个进程...")
        
        args_list = [(params, config, self.strategy_type, symbols, self.data_dir) 
                    for params in param_combinations]
        
        results = []
        if workers == 1:
            for i, args in enumerate(args_list):
                result = _single_backtest_worker(args)
                if result:
                    results.append(result)
                if progress_callback:
                    progress_callback(i + 1, total_combinations)
        else:
            with mp.Pool(processes=workers) as pool:
                completed = 0
                for result in pool.imap(_single_backtest_worker, args_list):
                    if result:
                        results.append(result)
                    completed += 1
                    if progress_callback:
                        progress_callback(completed, total_combinations)
        
        self.results = [
            OptimizationResult(
                parameters=r['parameters'],
                total_return=r['total_return'],
                sharpe_ratio=r['sharpe_ratio'],
                max_drawdown=r['max_drawdown'],
                win_rate=r['win_rate'],
                total_trades=r['total_trades'],
                final_equity=r['final_equity'],
                annualized_return=r['annualized_return'],
                execution_time=r['execution_time']
            ) for r in results if r
        ]
        
        self._find_best_result()
        
        return self.get_optimization_summary()
    
    def _find_best_result(self):
        if not self.results:
            self.best_result = None
            return
        
        if self.optimization_metric == "max_drawdown":
            best = min(self.results, key=lambda x: x.max_drawdown)
        elif self.optimization_metric == "win_rate":
            valid_results = [r for r in self.results if r.total_trades > 0]
            if valid_results:
                best = max(valid_results, key=lambda x: x.win_rate)
            else:
                best = self.results[0]
        else:
            best = max(self.results, key=lambda x: getattr(x, self.optimization_metric))
        
        self.best_result = best
    
    def get_optimization_summary(self) -> Dict[str, Any]:
        if not self.results:
            return {
                'status': 'error',
                'message': '没有优化结果'
            }
        
        results_df = pd.DataFrame([
            {
                **r.parameters,
                'total_return': r.total_return,
                'sharpe_ratio': r.sharpe_ratio,
                'max_drawdown': r.max_drawdown,
                'win_rate': r.win_rate,
                'total_trades': r.total_trades,
                'final_equity': r.final_equity,
                'annualized_return': r.annualized_return,
                'execution_time': r.execution_time
            } for r in self.results
        ])
        
        heatmap_data = self._generate_heatmap_data()
        
        return {
            'status': 'completed',
            'total_combinations': len(self.results),
            'optimization_metric': self.optimization_metric,
            'best_parameters': self.best_result.parameters if self.best_result else {},
            'best_performance': {
                'total_return': self.best_result.total_return if self.best_result else 0,
                'sharpe_ratio': self.best_result.sharpe_ratio if self.best_result else 0,
                'max_drawdown': self.best_result.max_drawdown if self.best_result else 0,
                'win_rate': self.best_result.win_rate if self.best_result else 0,
                'total_trades': self.best_result.total_trades if self.best_result else 0,
                'final_equity': self.best_result.final_equity if self.best_result else 0,
                'annualized_return': self.best_result.annualized_return if self.best_result else 0
            } if self.best_result else {},
            'heatmap_data': heatmap_data,
            'all_results': results_df.to_dict('records'),
            'statistics': {
                'avg_sharpe': results_df['sharpe_ratio'].mean(),
                'max_sharpe': results_df['sharpe_ratio'].max(),
                'min_sharpe': results_df['sharpe_ratio'].min(),
                'avg_return': results_df['total_return'].mean(),
                'max_return': results_df['total_return'].max(),
                'avg_drawdown': results_df['max_drawdown'].mean()
            }
        }
    
    def _generate_heatmap_data(self) -> Dict[str, Any]:
        if len(self.parameter_ranges) < 2:
            return {'available': False}
        
        param1 = self.parameter_ranges[0]
        param2 = self.parameter_ranges[1]
        
        x_values = sorted(list(set(r.parameters.get(param1.name) for r in self.results)))
        y_values = sorted(list(set(r.parameters.get(param2.name) for r in self.results)))
        
        z_data = []
        for y_val in y_values:
            row = []
            for x_val in x_values:
                matching = [r for r in self.results 
                          if r.parameters.get(param1.name) == x_val 
                          and r.parameters.get(param2.name) == y_val]
                if matching:
                    metric_value = getattr(matching[0], self.optimization_metric)
                    if self.optimization_metric == "max_drawdown":
                        row.append(float(metric_value))
                    else:
                        row.append(float(metric_value))
                else:
                    row.append(None)
            z_data.append(row)
        
        return {
            'available': True,
            'x_axis': param1.name,
            'y_axis': param2.name,
            'x_values': x_values,
            'y_values': y_values,
            'z_values': z_data,
            'metric': self.optimization_metric
        }
    
    def get_top_results(self, n: int = 10) -> List[Dict[str, Any]]:
        if not self.results:
            return []
        
        if self.optimization_metric == "max_drawdown":
            sorted_results = sorted(self.results, key=lambda x: x.max_drawdown)
        else:
            sorted_results = sorted(self.results, 
                                   key=lambda x: getattr(x, self.optimization_metric),
                                   reverse=True)
        
        return [
            {
                'parameters': r.parameters,
                'performance': {
                    'total_return': r.total_return,
                    'sharpe_ratio': r.sharpe_ratio,
                    'max_drawdown': r.max_drawdown,
                    'win_rate': r.win_rate,
                    'total_trades': r.total_trades
                }
            } for r in sorted_results[:n]
        ]
