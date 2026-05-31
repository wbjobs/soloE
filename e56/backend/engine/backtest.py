import queue
import pandas as pd
from typing import List, Dict, Any, Optional
from datetime import datetime
import gc
from collections import deque

from .data_handler import DataHandler
from .events import Event, MarketEvent, SignalEvent, OrderEvent, FillEvent, EventType
from .portfolio import Portfolio
from .broker import Broker, SlippageModel, CommissionModel
from .performance import PerformanceAnalyzer
from .memory_monitor import get_memory_monitor


class BoundedEventQueue:
    def __init__(self, max_size: int = 10000, enable_gc: bool = True):
        self._queue: deque = deque(maxlen=max_size)
        self.max_size = max_size
        self.enable_gc = enable_gc
        self._gc_threshold = max_size // 2
    
    def put(self, event: Event):
        if len(self._queue) >= self.max_size:
            self._queue.popleft()
        
        self._queue.append(event)
        
        if self.enable_gc and len(self._queue) > self._gc_threshold:
            gc.collect()
    
    def get(self) -> Optional[Event]:
        if self._queue:
            return self._queue.popleft()
        return None
    
    def empty(self) -> bool:
        return len(self._queue) == 0
    
    def qsize(self) -> int:
        return len(self._queue)
    
    def clear(self):
        self._queue.clear()
        if self.enable_gc:
            gc.collect()


class BacktestEngine:
    def __init__(self, initial_capital: float = 100000.0,
                 slippage_type: str = "fixed", slippage_params: dict = None,
                 commission_type: str = "percentage", commission_params: dict = None,
                 use_streaming: bool = False,
                 max_queue_size: int = 10000,
                 chunk_size: int = 10000,
                 enable_memory_monitoring: bool = True):
        self.use_streaming = use_streaming
        self.chunk_size = chunk_size
        
        if use_streaming:
            self.event_queue = BoundedEventQueue(max_size=max_queue_size, enable_gc=True)
        else:
            self.event_queue: queue.Queue = queue.Queue()
        
        self.data_handler = DataHandler(use_compression=True, chunk_size=chunk_size)
        
        slippage_model = SlippageModel(slippage_type, **(slippage_params or {}))
        commission_model = CommissionModel(commission_type, **(commission_params or {}))
        
        self.broker = Broker(slippage_model, commission_model)
        self.portfolio = Portfolio(initial_capital)
        self.performance_analyzer = PerformanceAnalyzer()
        self.strategy = None
        
        self.memory_monitor = None
        if enable_memory_monitoring:
            self.memory_monitor = get_memory_monitor()
            self._setup_memory_monitor()
        
        self._processed_events = 0
        self._gc_interval = 10000
        
    def _setup_memory_monitor(self):
        if self.memory_monitor:
            self.memory_monitor.set_event_queue_getter(
                lambda: self.event_queue.qsize() if hasattr(self.event_queue, 'qsize') else len(self.event_queue._queue) if hasattr(self.event_queue, '_queue') else 0
            )
            self.memory_monitor.set_portfolio_getter(
                lambda: self.portfolio.get_current_positions()
            )
            self.memory_monitor.set_data_handler_getter(
                lambda: self.data_handler.get_memory_usage()
            )
    
    def load_data(self, file_path: str, symbol: str, **kwargs) -> bool:
        return self.data_handler.load_csv(file_path, symbol, **kwargs)
    
    def set_strategy(self, strategy):
        self.strategy = strategy
    
    def _generate_market_events(self):
        if self.use_streaming:
            for ohlcv in self.data_handler.stream_merged_data():
                event = MarketEvent(
                    timestamp=ohlcv.timestamp,
                    symbol=ohlcv.symbol,
                    open=ohlcv.open,
                    high=ohlcv.high,
                    low=ohlcv.low,
                    close=ohlcv.close,
                    volume=ohlcv.volume
                )
                self.event_queue.put(event)
        else:
            merged_data = self.data_handler.get_merged_data()
            if merged_data.empty:
                return
            
            for _, row in merged_data.iterrows():
                event = MarketEvent(
                    timestamp=row['timestamp'],
                    symbol=row['symbol'],
                    open=row['open'],
                    high=row['high'],
                    low=row['low'],
                    close=row['close'],
                    volume=row['volume']
                )
                self.event_queue.put(event)
    
    def _process_event(self, event: Event):
        if event.event_type == EventType.MARKET:
            self._process_market_event(event)
        elif event.event_type == EventType.SIGNAL:
            self._process_signal_event(event)
        elif event.event_type == EventType.ORDER:
            self._process_order_event(event)
        elif event.event_type == EventType.FILL:
            self._process_fill_event(event)
        
        self._processed_events += 1
        if self._processed_events % self._gc_interval == 0:
            gc.collect()
            if self.memory_monitor:
                self.memory_monitor.take_snapshot()
    
    def _process_market_event(self, event: MarketEvent):
        self.portfolio.update_price(event.symbol, event.close, event.timestamp)
        
        if self.strategy:
            signal = self.strategy.calculate_signals(event)
            if signal:
                self.event_queue.put(signal)
    
    def _process_signal_event(self, event: SignalEvent):
        order = self.portfolio.generate_order(event, self.portfolio.current_prices.get(event.symbol, 0))
        if order:
            self.event_queue.put(order)
    
    def _process_order_event(self, event: OrderEvent):
        current_price = self.portfolio.current_prices.get(event.symbol, 0)
        if current_price == 0:
            return
        
        fill = self.broker.execute_order(event, current_price)
        if fill:
            self.event_queue.put(fill)
    
    def _process_fill_event(self, event: FillEvent):
        self.portfolio.execute_fill(event)
    
    def run(self) -> Dict[str, Any]:
        if not self.strategy:
            raise ValueError("Strategy not set")
        
        if self.memory_monitor:
            self.memory_monitor.reset()
            self.memory_monitor.take_snapshot()
        
        merged_data = self.data_handler.get_merged_data()
        
        for _, row in merged_data.iterrows():
            market_event = MarketEvent(
                timestamp=row['timestamp'],
                symbol=row['symbol'],
                open=row['open'],
                high=row['high'],
                low=row['low'],
                close=row['close'],
                volume=row['volume']
            )
            
            self._process_event(market_event)
            
            while not self.event_queue.empty():
                if isinstance(self.event_queue, BoundedEventQueue):
                    event = self.event_queue.get()
                else:
                    event = self.event_queue.get()
                
                if event and event.event_type != EventType.MARKET:
                    self._process_event(event)
                else:
                    break
        
        equity_curve = self.portfolio.get_equity_curve()
        trades = self.portfolio.get_trades()
        performance = self.performance_analyzer.analyze(equity_curve, trades)
        
        memory_stats = {}
        if self.memory_monitor:
            self.memory_monitor.take_snapshot()
            memory_stats = self.memory_monitor.get_memory_stats()
        
        results = {
            'performance': performance,
            'equity_curve': equity_curve.to_dict('records'),
            'trades': trades.to_dict('records'),
            'symbols': self.data_handler.get_all_symbols(),
            'memory_stats': memory_stats
        }
        
        self._cleanup()
        
        return results
    
    def _cleanup(self):
        if hasattr(self.event_queue, 'clear'):
            self.event_queue.clear()
        elif hasattr(self.event_queue, 'queue'):
            self.event_queue.queue.clear()
        
        if not self.use_streaming:
            self.data_handler.clear_data()
        
        gc.collect()
    
    def run_streaming(self, file_paths: Dict[str, str], **kwargs) -> Dict[str, Any]:
        if not self.strategy:
            raise ValueError("Strategy not set")
        
        if self.memory_monitor:
            self.memory_monitor.reset()
            self.memory_monitor.take_snapshot()
        
        iterators = {}
        for symbol, file_path in file_paths.items():
            iterator = self.data_handler.stream_csv(file_path, symbol, **kwargs)
            if iterator:
                iterators[symbol] = iterator
        
        if not iterators:
            raise ValueError("No valid data loaded")
        
        next_events = []
        for symbol, iterator in iterators.items():
            try:
                ohlcv = next(iterator)
                if ohlcv:
                    next_events.append((ohlcv.timestamp, ohlcv))
            except StopIteration:
                pass
        
        next_events.sort(key=lambda x: x[0])
        
        while next_events:
            timestamp, ohlcv = next_events.pop(0)
            
            market_event = MarketEvent(
                timestamp=ohlcv.timestamp,
                symbol=ohlcv.symbol,
                open=ohlcv.open,
                high=ohlcv.high,
                low=ohlcv.low,
                close=ohlcv.close,
                volume=ohlcv.volume
            )
            
            self._process_event(market_event)
            
            try:
                new_ohlcv = next(iterators[ohlcv.symbol])
                if new_ohlcv:
                    insert_pos = 0
                    while insert_pos < len(next_events) and next_events[insert_pos][0] < new_ohlcv.timestamp:
                        insert_pos += 1
                    next_events.insert(insert_pos, (new_ohlcv.timestamp, new_ohlcv))
            except StopIteration:
                pass
            
            while True:
                if isinstance(self.event_queue, BoundedEventQueue):
                    if self.event_queue.empty():
                        break
                    event = self.event_queue.get()
                else:
                    if self.event_queue.empty():
                        break
                    event = self.event_queue.get()
                
                if event and event.event_type != EventType.MARKET:
                    self._process_event(event)
                else:
                    if event:
                        self.event_queue.put(event)
                    break
        
        equity_curve = self.portfolio.get_equity_curve()
        trades = self.portfolio.get_trades()
        performance = self.performance_analyzer.analyze(equity_curve, trades)
        
        memory_stats = {}
        if self.memory_monitor:
            self.memory_monitor.take_snapshot()
            memory_stats = self.memory_monitor.get_memory_stats()
        
        results = {
            'performance': performance,
            'equity_curve': equity_curve.to_dict('records'),
            'trades': trades.to_dict('records'),
            'symbols': list(file_paths.keys()),
            'memory_stats': memory_stats
        }
        
        self._cleanup()
        
        return results

    def get_memory_stats(self) -> Dict[str, Any]:
        if self.memory_monitor:
            return self.memory_monitor.get_memory_stats()
        return {}
    
    def get_memory_trend(self, last_n: int = 100) -> Dict[str, List]:
        if self.memory_monitor:
            return self.memory_monitor.get_memory_trend(last_n)
        return {}
    
    def get_symbol_data(self, symbol: str) -> pd.DataFrame:
        return self.data_handler.get_data(symbol)
