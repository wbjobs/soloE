import threading
import time
import os
from typing import Dict, Optional, List, Any, Tuple
import docker

from .ebpf import BPFWrapper
from .storage import Storage


class ContainerTracker:
    def __init__(self, container_id: str, storage: Storage, bpf: BPFWrapper):
        self.container_id = container_id
        self.storage = storage
        self.bpf = bpf
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._pidns: Optional[int] = None
        self._docker_client = docker.from_env()
        self._window_start: int = 0
        self._total_lost: int = 0

    def _get_container_pidns(self) -> Optional[int]:
        try:
            container = self._docker_client.containers.get(self.container_id)
            if container.status != "running":
                return None
            pid = container.attrs["State"]["Pid"]
            pidns_path = f"/proc/{pid}/ns/pid"
            if os.path.exists(pidns_path):
                return os.stat(pidns_path).st_ino
        except Exception:
            return None
        return None

    def _collect_and_store(self):
        now = time.time_ns()
        window_end = now

        stats = self.bpf.collect_stats(self.container_id)
        lost = self.bpf.get_and_reset_lost()

        if stats:
            self.storage.insert_aggregated(
                self.container_id,
                stats,
                self._window_start,
                window_end,
            )

        if lost > 0:
            self._total_lost += lost
            self.storage.insert_lost(self.container_id, lost, now)

        self._window_start = window_end

    def _poll_loop(self):
        self._window_start = time.time_ns()
        while self._running:
            try:
                time.sleep(1.0)
                self._collect_and_store()
            except Exception:
                time.sleep(0.1)

    def start(self) -> bool:
        self._pidns = self._get_container_pidns()
        if self._pidns is None:
            return False

        self.bpf.set_container_pidns(self.container_id, self._pidns)
        self._running = True
        self._total_lost = 0
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()
        return True

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)
            self._thread = None
        try:
            self._collect_and_store()
        except Exception:
            pass
        self.bpf.remove_container_pidns(self.container_id)

    def is_running(self) -> bool:
        return self._running and self._thread is not None and self._thread.is_alive()

    def get_lost_events(self) -> int:
        return self._total_lost


class TrackerManager:
    def __init__(self, storage: Storage):
        self.storage = storage
        self.bpf = BPFWrapper()
        self._trackers: Dict[str, ContainerTracker] = {}
        self._lock = threading.Lock()
        self._bpf_loaded = False
        self._bpf_attached = False

    def _ensure_bpf_loaded(self):
        if not self._bpf_loaded:
            self.bpf.load()
            self._bpf_loaded = True
        if not self._bpf_attached:
            self.bpf.attach()
            self._bpf_attached = True

    def start_tracking(self, container_id: str) -> bool:
        with self._lock:
            if container_id in self._trackers and self._trackers[container_id].is_running():
                return True

            self._ensure_bpf_loaded()

            tracker = ContainerTracker(container_id, self.storage, self.bpf)
            success = tracker.start()
            if success:
                self._trackers[container_id] = tracker
            return success

    def stop_tracking(self, container_id: str) -> bool:
        with self._lock:
            tracker = self._trackers.get(container_id)
            if tracker is None:
                return False

            tracker.stop()
            del self._trackers[container_id]

            if len(self._trackers) == 0 and self._bpf_attached:
                self.bpf.detach()
                self._bpf_attached = False

            return True

    def is_tracking(self, container_id: str) -> bool:
        with self._lock:
            tracker = self._trackers.get(container_id)
            return tracker is not None and tracker.is_running()

    def list_tracking_containers(self) -> List[str]:
        with self._lock:
            return [cid for cid, tracker in self._trackers.items() if tracker.is_running()]

    def get_results(
        self,
        container_id: str,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        results = self.storage.get_aggregated_results(container_id, start_time, end_time)
        lost = self.storage.get_lost_events(container_id, start_time, end_time)

        with self._lock:
            tracker = self._trackers.get(container_id)
            if tracker:
                lost += tracker.get_lost_events()

        return results, lost

    def get_stats(self, container_id: str) -> Dict[str, Any]:
        stats = self.storage.get_container_stats(container_id)

        with self._lock:
            tracker = self._trackers.get(container_id)
            if tracker:
                stats["total_lost"] += tracker.get_lost_events()
                stats["is_tracking"] = True
            else:
                stats["is_tracking"] = False

        return stats

    def get_hot_files(
        self,
        container_id: str,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        return self.storage.get_hot_files(container_id, start_time, end_time, limit)

    def cleanup(self):
        with self._lock:
            for tracker in self._trackers.values():
                tracker.stop()
            self._trackers.clear()

            if self._bpf_attached:
                self.bpf.detach()
                self._bpf_attached = False
            if self._bpf_loaded:
                self.bpf.unload()
                self._bpf_loaded = False
