import psutil
import os
import gc
from typing import Dict, List, Callable
from dataclasses import dataclass, field
from datetime import datetime
import threading
import time


@dataclass
class MemorySnapshot:
    timestamp: datetime
    rss_mb: float
    vms_mb: float
    percent: float
    event_queue_size: int = 0
    portfolio_positions_count: int = 0
    data_handler_memory_mb: float = 0.0
    custom_metrics: Dict[str, float] = field(default_factory=dict)


class MemoryMonitor:
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if hasattr(self, '_initialized') and self._initialized:
            return
        
        self._initialized = True
        self.process = psutil.Process(os.getpid())
        self.snapshots: List[MemorySnapshot] = []
        self.max_snapshots = 1000
        self.alert_thresholds: Dict[str, float] = {
            'warning': 4000.0,
            'critical': 6000.0
        }
        self.alert_callbacks: List[Callable] = []
        self._monitoring_thread = None
        self._stop_monitoring = threading.Event()
        self._event_queue_getter = None
        self._portfolio_getter = None
        self._data_handler_getter = None
        
    def set_event_queue_getter(self, getter: Callable):
        self._event_queue_getter = getter
    
    def set_portfolio_getter(self, getter: Callable):
        self._portfolio_getter = getter
    
    def set_data_handler_getter(self, getter: Callable):
        self._data_handler_getter = getter
    
    def get_current_memory(self) -> Dict[str, float]:
        try:
            mem_info = self.process.memory_info()
            return {
                'rss_mb': mem_info.rss / 1024 / 1024,
                'vms_mb': mem_info.vms / 1024 / 1024,
                'percent': self.process.memory_percent()
            }
        except:
            return {'rss_mb': 0.0, 'vms_mb': 0.0, 'percent': 0.0}
    
    def take_snapshot(self, custom_metrics: Dict[str, float] = None) -> MemorySnapshot:
        mem = self.get_current_memory()
        
        event_queue_size = 0
        if self._event_queue_getter:
            try:
                event_queue_size = self._event_queue_getter()
            except:
                pass
        
        positions_count = 0
        if self._portfolio_getter:
            try:
                positions = self._portfolio_getter()
                positions_count = len(positions) if positions else 0
            except:
                pass
        
        data_handler_memory = 0.0
        if self._data_handler_getter:
            try:
                mem_info = self._data_handler_getter()
                data_handler_memory = mem_info.get('total_mb', 0.0)
            except:
                pass
        
        snapshot = MemorySnapshot(
            timestamp=datetime.now(),
            rss_mb=mem['rss_mb'],
            vms_mb=mem['vms_mb'],
            percent=mem['percent'],
            event_queue_size=event_queue_size,
            portfolio_positions_count=positions_count,
            data_handler_memory_mb=data_handler_memory,
            custom_metrics=custom_metrics or {}
        )
        
        self.snapshots.append(snapshot)
        
        if len(self.snapshots) > self.max_snapshots:
            self.snapshots = self.snapshots[-self.max_snapshots:]
        
        self._check_alerts(snapshot)
        
        return snapshot
    
    def _check_alerts(self, snapshot: MemorySnapshot):
        for level, threshold in self.alert_thresholds.items():
            if snapshot.rss_mb >= threshold:
                for callback in self.alert_callbacks:
                    try:
                        callback(level, snapshot)
                    except:
                        pass
    
    def add_alert_callback(self, callback: Callable):
        self.alert_callbacks.append(callback)
    
    def set_alert_threshold(self, level: str, threshold_mb: float):
        self.alert_thresholds[level] = threshold_mb
    
    def start_background_monitoring(self, interval_seconds: float = 1.0):
        if self._monitoring_thread and self._monitoring_thread.is_alive():
            return
        
        self._stop_monitoring.clear()
        
        def monitor_loop():
            while not self._stop_monitoring.is_set():
                self.take_snapshot()
                time.sleep(interval_seconds)
        
        self._monitoring_thread = threading.Thread(target=monitor_loop, daemon=True)
        self._monitoring_thread.start()
    
    def stop_background_monitoring(self):
        self._stop_monitoring.set()
        if self._monitoring_thread:
            self._monitoring_thread.join(timeout=5.0)
    
    def get_memory_stats(self) -> Dict[str, any]:
        if not self.snapshots:
            mem = self.get_current_memory()
            return {
                'current_rss_mb': mem['rss_mb'],
                'current_vms_mb': mem['vms_mb'],
                'current_percent': mem['percent'],
                'peak_rss_mb': mem['rss_mb'],
                'avg_rss_mb': mem['rss_mb'],
                'snapshot_count': 0
            }
        
        rss_values = [s.rss_mb for s in self.snapshots]
        return {
            'current_rss_mb': self.snapshots[-1].rss_mb,
            'current_vms_mb': self.snapshots[-1].vms_mb,
            'current_percent': self.snapshots[-1].percent,
            'peak_rss_mb': max(rss_values),
            'avg_rss_mb': sum(rss_values) / len(rss_values),
            'snapshot_count': len(self.snapshots),
            'event_queue_size': self.snapshots[-1].event_queue_size,
            'portfolio_positions_count': self.snapshots[-1].portfolio_positions_count,
            'data_handler_memory_mb': self.snapshots[-1].data_handler_memory_mb,
            'time_range': {
                'start': self.snapshots[0].timestamp.isoformat(),
                'end': self.snapshots[-1].timestamp.isoformat()
            }
        }
    
    def get_memory_trend(self, last_n: int = 100) -> Dict[str, List]:
        snapshots = self.snapshots[-last_n:] if len(self.snapshots) > last_n else self.snapshots
        
        return {
            'timestamps': [s.timestamp.isoformat() for s in snapshots],
            'rss_mb': [s.rss_mb for s in snapshots],
            'event_queue_size': [s.event_queue_size for s in snapshots],
            'positions_count': [s.portfolio_positions_count for s in snapshots]
        }
    
    def force_gc(self) -> Dict[str, float]:
        gc.collect()
        return self.get_current_memory()
    
    def reset(self):
        self.snapshots.clear()
        gc.collect()


_memory_monitor_instance = MemoryMonitor()


def get_memory_monitor() -> MemoryMonitor:
    return _memory_monitor_instance
