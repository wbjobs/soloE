from abc import ABC, abstractmethod
from typing import List, Optional, Dict
import pandas as pd
from datetime import datetime
from ..engine.events import MarketEvent, SignalEvent, SignalType


class BaseStrategy(ABC):
    def __init__(self, symbols: List[str]):
        self.symbols = symbols
        self.data: Dict[str, List[dict]] = {symbol: [] for symbol in symbols}
        self.indicators: Dict[str, pd.DataFrame] = {}

    def update_data(self, event: MarketEvent):
        symbol_data = {
            'timestamp': event.timestamp,
            'open': event.open,
            'high': event.high,
            'low': event.low,
            'close': event.close,
            'volume': event.volume
        }
        self.data[event.symbol].append(symbol_data)

    def get_symbol_data(self, symbol: str) -> pd.DataFrame:
        if symbol not in self.data or not self.data[symbol]:
            return pd.DataFrame()
        return pd.DataFrame(self.data[symbol])

    @abstractmethod
    def calculate_signals(self, event: MarketEvent) -> Optional[SignalEvent]:
        pass
