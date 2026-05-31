from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


class EventType(Enum):
    MARKET = 'MARKET'
    SIGNAL = 'SIGNAL'
    ORDER = 'ORDER'
    FILL = 'FILL'


class SignalType(Enum):
    BUY = 'BUY'
    SELL = 'SELL'
    HOLD = 'HOLD'


class OrderType(Enum):
    MARKET = 'MARKET'
    LIMIT = 'LIMIT'
    STOP = 'STOP'


@dataclass
class Event:
    pass


@dataclass
class MarketEvent(Event):
    timestamp: datetime
    symbol: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    event_type: EventType = field(init=False, default=EventType.MARKET)


@dataclass
class SignalEvent(Event):
    timestamp: datetime
    symbol: str
    signal_type: SignalType
    strength: float = 1.0
    event_type: EventType = field(init=False, default=EventType.SIGNAL)


@dataclass
class OrderEvent(Event):
    timestamp: datetime
    symbol: str
    order_type: OrderType
    quantity: int
    price: Optional[float] = None
    event_type: EventType = field(init=False, default=EventType.ORDER)


@dataclass
class FillEvent(Event):
    timestamp: datetime
    symbol: str
    quantity: int
    price: float
    commission: float
    slippage: float
    event_type: EventType = field(init=False, default=EventType.FILL)
