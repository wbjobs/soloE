import sqlite3
import threading
import time
from typing import Optional, List, Dict, Any
from contextlib import contextmanager


SCHEMA = """
CREATE TABLE IF NOT EXISTS syscall_aggregated (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id TEXT NOT NULL,
    comm TEXT NOT NULL,
    filename TEXT NOT NULL,
    syscall_type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL,
    window_end INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lost_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id TEXT NOT NULL,
    lost_count INTEGER NOT NULL DEFAULT 0,
    timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agg_container ON syscall_aggregated(container_id);
CREATE INDEX IF NOT EXISTS idx_agg_container_window ON syscall_aggregated(container_id, window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_lost_container ON lost_events(container_id);
CREATE INDEX IF NOT EXISTS idx_lost_container_ts ON lost_events(container_id, timestamp);
"""


class Storage:
    def __init__(self, db_path: str = "syscall_tracker.db"):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    @contextmanager
    def _get_conn(self):
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self):
        with self._lock:
            with self._get_conn() as conn:
                conn.executescript(SCHEMA)

    def insert_aggregated(
        self,
        container_id: str,
        stats: Dict[str, Dict[str, Dict[str, int]]],
        window_start: int,
        window_end: int,
    ):
        with self._lock:
            with self._get_conn() as conn:
                for file_key, syscalls in stats.items():
                    parts = file_key.split("||", 1)
                    if len(parts) != 2:
                        continue
                    comm, filename = parts
                    for syscall_type, data in syscalls.items():
                        conn.execute(
                            """
                            INSERT INTO syscall_aggregated (
                                container_id, comm, filename, syscall_type,
                                count, bytes, window_start, window_end
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                container_id,
                                comm,
                                filename,
                                syscall_type,
                                data["count"],
                                data["bytes"],
                                window_start,
                                window_end,
                            ),
                        )

    def insert_lost(self, container_id: str, lost_count: int, timestamp: int):
        if lost_count <= 0:
            return
        with self._lock:
            with self._get_conn() as conn:
                conn.execute(
                    "INSERT INTO lost_events (container_id, lost_count, timestamp) VALUES (?, ?, ?)",
                    (container_id, lost_count, timestamp),
                )

    def get_aggregated_results(
        self,
        container_id: str,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        if start_time is None:
            start_time = 0
        if end_time is None:
            end_time = int(time.time_ns())

        query = """
        SELECT
            comm,
            filename,
            syscall_type,
            SUM(count) as call_count,
            SUM(bytes) as total_bytes
        FROM syscall_aggregated
        WHERE container_id = ?
          AND window_end >= ?
          AND window_start <= ?
        GROUP BY comm, filename, syscall_type
        ORDER BY call_count DESC
        """

        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.execute(query, (container_id, start_time, end_time))
                rows = cursor.fetchall()

        results: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            key = f"{row['comm']}||{row['filename']}"
            if key not in results:
                results[key] = {
                    "process_name": row["comm"],
                    "file_path": row["filename"],
                    "syscall_stats": {},
                    "total_calls": 0,
                }
            results[key]["syscall_stats"][row["syscall_type"]] = {
                "count": row["call_count"],
                "bytes": row["total_bytes"],
            }
            results[key]["total_calls"] += row["call_count"]

        return list(results.values())

    def get_lost_events(
        self,
        container_id: str,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
    ) -> int:
        if start_time is None:
            start_time = 0
        if end_time is None:
            end_time = int(time.time_ns())

        query = """
        SELECT COALESCE(SUM(lost_count), 0) as total_lost
        FROM lost_events
        WHERE container_id = ?
          AND timestamp >= ?
          AND timestamp <= ?
        """

        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.execute(query, (container_id, start_time, end_time))
                row = cursor.fetchone()
                return row["total_lost"]

    def get_container_stats(self, container_id: str) -> Dict[str, Any]:
        query_agg = """
        SELECT
            SUM(count) as total_events,
            MIN(window_start) as first_timestamp,
            MAX(window_end) as last_timestamp,
            COUNT(DISTINCT comm) as unique_processes,
            COUNT(DISTINCT filename) as unique_files
        FROM syscall_aggregated
        WHERE container_id = ?
        """

        query_lost = """
        SELECT COALESCE(SUM(lost_count), 0) as total_lost
        FROM lost_events
        WHERE container_id = ?
        """

        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.execute(query_agg, (container_id,))
                row = cursor.fetchone()

                cursor2 = conn.execute(query_lost, (container_id,))
                lost_row = cursor2.fetchone()

        if row["total_events"] is None or row["total_events"] == 0:
            return {
                "total_events": 0,
                "tracking_duration_ms": 0,
                "unique_processes": 0,
                "unique_files": 0,
                "total_lost": lost_row["total_lost"],
            }

        return {
            "total_events": row["total_events"],
            "tracking_duration_ms": (row["last_timestamp"] - row["first_timestamp"]) // 1_000_000,
            "unique_processes": row["unique_processes"],
            "unique_files": row["unique_files"],
            "total_lost": lost_row["total_lost"],
        }

    def get_hot_files(
        self,
        container_id: str,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        if start_time is None:
            start_time = 0
        if end_time is None:
            end_time = int(time.time_ns())

        query = """
        SELECT
            filename,
            SUM(CASE WHEN syscall_type = 'read' THEN count ELSE 0 END) as read_count,
            SUM(CASE WHEN syscall_type = 'write' THEN count ELSE 0 END) as write_count,
            SUM(CASE WHEN syscall_type = 'read' THEN bytes ELSE 0 END) as read_bytes,
            SUM(CASE WHEN syscall_type = 'write' THEN bytes ELSE 0 END) as write_bytes,
            SUM(count) as total_count
        FROM syscall_aggregated
        WHERE container_id = ?
          AND window_end >= ?
          AND window_start <= ?
        GROUP BY filename
        ORDER BY total_count DESC
        LIMIT ?
        """

        with self._lock:
            with self._get_conn() as conn:
                cursor = conn.execute(query, (container_id, start_time, end_time, limit))
                rows = cursor.fetchall()

        results = []
        for row in rows:
            read_count = row["read_count"] or 0
            write_count = row["write_count"] or 0
            total = read_count + write_count

            if total == 0:
                read_ratio = 0.0
                write_ratio = 0.0
            else:
                read_ratio = round(read_count / total, 4)
                write_ratio = round(write_count / total, 4)

            results.append({
                "file_path": row["filename"],
                "read_count": read_count,
                "write_count": write_count,
                "read_bytes": row["read_bytes"] or 0,
                "write_bytes": row["write_bytes"] or 0,
                "total_count": row["total_count"] or 0,
                "read_ratio": read_ratio,
                "write_ratio": write_ratio,
                "ratio_label": f"{read_ratio * 100:.1f}%:{write_ratio * 100:.1f}%",
            })

        return results

    def clear_container_data(self, container_id: str):
        with self._lock:
            with self._get_conn() as conn:
                conn.execute(
                    "DELETE FROM syscall_aggregated WHERE container_id = ?",
                    (container_id,),
                )
                conn.execute(
                    "DELETE FROM lost_events WHERE container_id = ?",
                    (container_id,),
                )
