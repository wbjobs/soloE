import psutil
import time
from collections import deque
from typing import Deque, List, Tuple, Dict


class SystemMonitorData:
    def __init__(self, history_size: int = 30):
        self.history_size = history_size
        self.cpu_history: Deque[List[float]] = deque(maxlen=history_size)
        self.memory_history: Deque[float] = deque(maxlen=history_size)
        self.network_sent_history: Deque[float] = deque(maxlen=history_size)
        self.network_recv_history: Deque[float] = deque(maxlen=history_size)
        
        self._last_net_io = psutil.net_io_counters()
        self._last_time = time.time()

    def get_cpu_percent(self, per_core: bool = True) -> List[float]:
        return psutil.cpu_percent(interval=None, percpu=per_core)

    def get_memory_info(self) -> Tuple[float, float, float]:
        mem = psutil.virtual_memory()
        return mem.percent, mem.used / (1024 ** 3), mem.total / (1024 ** 3)

    def get_network_speed(self) -> Tuple[float, float]:
        current_net_io = psutil.net_io_counters()
        current_time = time.time()
        
        time_diff = current_time - self._last_time
        if time_diff == 0:
            time_diff = 1
            
        sent_speed = (current_net_io.bytes_sent - self._last_net_io.bytes_sent) / time_diff
        recv_speed = (current_net_io.bytes_recv - self._last_net_io.bytes_recv) / time_diff
        
        self._last_net_io = current_net_io
        self._last_time = current_time
        
        return sent_speed / 1024, recv_speed / 1024

    def update_history(self) -> None:
        cpu_percents = self.get_cpu_percent(per_core=True)
        self.cpu_history.append(cpu_percents)
        
        mem_percent, _, _ = self.get_memory_info()
        self.memory_history.append(mem_percent)
        
        sent_speed, recv_speed = self.get_network_speed()
        self.network_sent_history.append(sent_speed)
        self.network_recv_history.append(recv_speed)

    def get_cpu_history_avg(self) -> Deque[float]:
        return deque([sum(core) / len(core) for core in self.cpu_history], maxlen=self.history_size)

    def get_core_count(self) -> int:
        return psutil.cpu_count(logical=True)

    def format_speed(self, speed_kb: float) -> str:
        if speed_kb < 1024:
            return f"{speed_kb:.1f} KB/s"
        else:
            return f"{speed_kb / 1024:.2f} MB/s"

    def get_top_processes(self, limit: int = 10) -> List[Dict]:
        processes = []
        for proc in psutil.process_iter(['pid', 'name', 'cpu_percent']):
            try:
                proc_info = proc.info
                if proc_info['cpu_percent'] is not None:
                    processes.append({
                        'pid': proc_info['pid'],
                        'name': proc_info['name'],
                        'cpu_percent': proc_info['cpu_percent']
                    })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
        
        processes.sort(key=lambda x: x['cpu_percent'], reverse=True)
        return processes[:limit]
