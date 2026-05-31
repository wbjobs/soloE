from typing import Optional, List
import pandas as pd
from .base_strategy import BaseStrategy
from ..engine.events import MarketEvent, SignalEvent, SignalType


class MovingAverageCrossStrategy(BaseStrategy):
    def __init__(self, symbols: List[str], short_window: int = 5, long_window: int = 20):
        super().__init__(symbols)
        self.short_window = short_window
        self.long_window = long_window
        self.positions = {symbol: 0 for symbol in symbols}

    def calculate_signals(self, event: MarketEvent) -> Optional[SignalEvent]:
        symbol = event.symbol
        self.update_data(event)
        
        df = self.get_symbol_data(symbol)
        
        if len(df) < self.long_window:
            return None
        
        df['ma_short'] = df['close'].rolling(window=self.short_window).mean()
        df['ma_long'] = df['close'].rolling(window=self.long_window).mean()
        
        current = df.iloc[-1]
        prev = df.iloc[-2]
        
        ma_short_curr = current['ma_short']
        ma_long_curr = current['ma_long']
        ma_short_prev = prev['ma_short']
        ma_long_prev = prev['ma_long']
        
        if pd.isna(ma_short_curr) or pd.isna(ma_long_curr):
            return None
        
        signal_type = None
        
        if ma_short_prev <= ma_long_prev and ma_short_curr > ma_long_curr:
            signal_type = SignalType.BUY
        elif ma_short_prev >= ma_long_prev and ma_short_curr < ma_long_curr:
            signal_type = SignalType.SELL
        
        if signal_type:
            return SignalEvent(
                timestamp=event.timestamp,
                symbol=symbol,
                signal_type=signal_type
            )
        
        return None
