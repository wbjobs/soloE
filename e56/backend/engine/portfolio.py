import pandas as pd
import numpy as np
from typing import Dict, List, Optional
from datetime import datetime
from dataclasses import dataclass
from .events import FillEvent, SignalEvent, OrderEvent, OrderType, SignalType


@dataclass
class Position:
    symbol: str
    quantity: int
    avg_price: float
    market_value: float = 0.0
    unrealized_pnl: float = 0.0


class Portfolio:
    def __init__(self, initial_capital: float = 100000.0):
        self.initial_capital = initial_capital
        self.current_capital = initial_capital
        self.positions: Dict[str, Position] = {}
        self.historical_values: List[dict] = []
        self.trades: List[dict] = []
        self.current_prices: Dict[str, float] = {}

    def update_price(self, symbol: str, price: float, timestamp: datetime):
        self.current_prices[symbol] = price
        
        if symbol in self.positions:
            pos = self.positions[symbol]
            pos.market_value = pos.quantity * price
            pos.unrealized_pnl = (price - pos.avg_price) * pos.quantity
        
        self._record_equity(timestamp)

    def _record_equity(self, timestamp: datetime):
        total_position_value = sum(pos.market_value for pos in self.positions.values())
        total_equity = self.current_capital + total_position_value
        
        self.historical_values.append({
            'timestamp': timestamp,
            'cash': self.current_capital,
            'position_value': total_position_value,
            'total_equity': total_equity
        })

    def generate_order(self, signal: SignalEvent, current_price: float) -> Optional[OrderEvent]:
        symbol = signal.symbol
        current_pos = self.positions.get(symbol)
        current_qty = current_pos.quantity if current_pos else 0
        
        if signal.signal_type == SignalType.BUY and current_qty == 0:
            total_equity = self.current_capital + sum(pos.market_value for pos in self.positions.values())
            max_shares = int(total_equity * 0.95 / current_price)
            if max_shares > 0:
                return OrderEvent(
                    timestamp=signal.timestamp,
                    symbol=symbol,
                    order_type=OrderType.MARKET,
                    quantity=max_shares
                )
        
        elif signal.signal_type == SignalType.SELL and current_qty > 0:
            return OrderEvent(
                timestamp=signal.timestamp,
                symbol=symbol,
                order_type=OrderType.MARKET,
                quantity=-current_qty
            )
        
        return None

    def execute_fill(self, fill: FillEvent):
        symbol = fill.symbol
        quantity = fill.quantity
        price = fill.price
        
        if symbol not in self.positions:
            self.positions[symbol] = Position(symbol=symbol, quantity=0, avg_price=0.0)
        
        pos = self.positions[symbol]
        
        if quantity > 0:
            total_cost = quantity * price + fill.commission
            new_qty = pos.quantity + quantity
            new_avg = (pos.quantity * pos.avg_price + quantity * price) / new_qty if new_qty > 0 else 0.0
            pos.quantity = new_qty
            pos.avg_price = new_avg
            self.current_capital -= total_cost
        else:
            sell_quantity = abs(quantity)
            proceeds = sell_quantity * price - fill.commission
            self.current_capital += proceeds
            pos.quantity -= sell_quantity
        
        if pos.quantity == 0:
            del self.positions[symbol]
        
        self.trades.append({
            'timestamp': fill.timestamp,
            'symbol': symbol,
            'quantity': quantity,
            'price': price,
            'commission': fill.commission,
            'slippage': fill.slippage
        })

    def get_equity_curve(self) -> pd.DataFrame:
        if not self.historical_values:
            return pd.DataFrame()
        
        df = pd.DataFrame(self.historical_values)
        df['returns'] = df['total_equity'].pct_change().fillna(0)
        return df

    def get_trades(self) -> pd.DataFrame:
        return pd.DataFrame(self.trades) if self.trades else pd.DataFrame()

    def get_current_positions(self) -> Dict[str, Position]:
        return self.positions.copy()
