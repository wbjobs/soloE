import pandas as pd
import numpy as np
from typing import Dict, Any


class PerformanceAnalyzer:
    def __init__(self, risk_free_rate: float = 0.02):
        self.risk_free_rate = risk_free_rate

    def analyze(self, equity_curve: pd.DataFrame, trades: pd.DataFrame) -> Dict[str, Any]:
        if equity_curve.empty:
            return {}
        
        results = {}
        
        total_return = (equity_curve.iloc[-1]['total_equity'] - 
                       equity_curve.iloc[0]['total_equity']) / equity_curve.iloc[0]['total_equity']
        results['total_return'] = total_return
        
        results['annualized_return'] = self._calculate_annualized_return(equity_curve)
        results['max_drawdown'] = self._calculate_max_drawdown(equity_curve)
        results['sharpe_ratio'] = self._calculate_sharpe_ratio(equity_curve)
        results['sortino_ratio'] = self._calculate_sortino_ratio(equity_curve)
        results['volatility'] = self._calculate_volatility(equity_curve)
        
        if not trades.empty:
            results['win_rate'] = self._calculate_win_rate(trades)
            results['total_trades'] = len(trades)
            results['avg_trade_return'] = self._calculate_avg_trade_return(trades)
        
        results['final_equity'] = equity_curve.iloc[-1]['total_equity']
        
        return results

    def _calculate_max_drawdown(self, df: pd.DataFrame) -> float:
        peak = df['total_equity'].expanding().max()
        drawdown = (df['total_equity'] - peak) / peak
        return drawdown.min()

    def _calculate_sharpe_ratio(self, df: pd.DataFrame) -> float:
        daily_returns = df.groupby(df['timestamp'].dt.date)['returns'].apply(
            lambda x: (1 + x).prod() - 1
        )
        
        if len(daily_returns) < 2:
            return 0.0
        
        excess_returns = daily_returns - self.risk_free_rate / 252
        sharpe = np.sqrt(252) * excess_returns.mean() / excess_returns.std() if excess_returns.std() != 0 else 0.0
        return sharpe

    def _calculate_sortino_ratio(self, df: pd.DataFrame) -> float:
        daily_returns = df.groupby(df['timestamp'].dt.date)['returns'].apply(
            lambda x: (1 + x).prod() - 1
        )
        
        if len(daily_returns) < 2:
            return 0.0
        
        excess_returns = daily_returns - self.risk_free_rate / 252
        downside_returns = daily_returns[daily_returns < 0]
        
        if len(downside_returns) == 0 or downside_returns.std() == 0:
            return 0.0
        
        sortino = np.sqrt(252) * excess_returns.mean() / downside_returns.std()
        return sortino

    def _calculate_annualized_return(self, df: pd.DataFrame) -> float:
        total_days = (df.iloc[-1]['timestamp'] - df.iloc[0]['timestamp']).days
        if total_days == 0:
            return 0.0
        
        total_return = (df.iloc[-1]['total_equity'] / df.iloc[0]['total_equity']) - 1
        annualized = (1 + total_return) ** (365 / total_days) - 1
        return annualized

    def _calculate_volatility(self, df: pd.DataFrame) -> float:
        daily_returns = df.groupby(df['timestamp'].dt.date)['returns'].apply(
            lambda x: (1 + x).prod() - 1
        )
        
        if len(daily_returns) < 2:
            return 0.0
        
        return np.sqrt(252) * daily_returns.std()

    def _calculate_win_rate(self, trades: pd.DataFrame) -> float:
        if trades.empty:
            return 0.0
        
        buy_trades = trades[trades['quantity'] > 0]
        sell_trades = trades[trades['quantity'] < 0]
        
        if len(buy_trades) == 0 or len(sell_trades) == 0:
            return 0.0
        
        wins = 0
        total = 0
        
        for i in range(min(len(buy_trades), len(sell_trades))):
            buy = buy_trades.iloc[i]
            sell = sell_trades.iloc[i]
            pnl = (sell['price'] - buy['price']) * abs(buy['quantity']) - buy['commission'] - sell['commission']
            if pnl > 0:
                wins += 1
            total += 1
        
        return wins / total if total > 0 else 0.0

    def _calculate_avg_trade_return(self, trades: pd.DataFrame) -> float:
        if trades.empty:
            return 0.0
        
        buy_trades = trades[trades['quantity'] > 0]
        sell_trades = trades[trades['quantity'] < 0]
        
        if len(buy_trades) == 0 or len(sell_trades) == 0:
            return 0.0
        
        returns = []
        
        for i in range(min(len(buy_trades), len(sell_trades))):
            buy = buy_trades.iloc[i]
            sell = sell_trades.iloc[i]
            pnl = (sell['price'] - buy['price']) * abs(buy['quantity']) - buy['commission'] - sell['commission']
            returns.append(pnl / (buy['price'] * abs(buy['quantity'])))
        
        return np.mean(returns) if returns else 0.0
