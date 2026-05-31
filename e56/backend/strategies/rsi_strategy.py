from typing import Optional, List
import pandas as pd
import numpy as np
from .base_strategy import BaseStrategy
from ..engine.events import MarketEvent, SignalEvent, SignalType


def calculate_rsi(prices, period=14):
    delta = pd.Series(prices).diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


class RSIStrategy(BaseStrategy):
    def __init__(self, symbols: List[str], period: int = 14, 
                 overbought: float = 70.0, oversold: float = 30.0):
        super().__init__(symbols)
        self.period = period
        self.overbought = overbought
        self.oversold = oversold

    def calculate_signals(self, event: MarketEvent) -> Optional[SignalEvent]:
        symbol = event.symbol
        self.update_data(event)
        
        df = self.get_symbol_data(symbol)
        
        if len(df) < self.period + 1:
            return None
        
        rsi_values = calculate_rsi(df['close'].values, self.period)
        
        current_rsi = rsi_values.iloc[-1]
        prev_rsi = rsi_values.iloc[-2]
        
        if pd.isna(current_rsi) or pd.isna(prev_rsi):
            return None
        
        signal_type = None
        
        if prev_rsi >= self.oversold and current_rsi < self.oversold:
            signal_type = SignalType.BUY
        elif prev_rsi <= self.overbought and current_rsi > self.overbought:
            signal_type = SignalType.SELL
        
        if signal_type:
            return SignalEvent(
                timestamp=event.timestamp,
                symbol=symbol,
                signal_type=signal_type
            )
        
        return None
