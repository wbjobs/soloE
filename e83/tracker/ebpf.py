import ctypes
import os
import time
from typing import Callable, Optional, Dict
from collections import defaultdict
from bcc import BPF


BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/fs.h>
#include <linux/sched.h>
#include <linux/dcache.h>

struct key_t {
    u32 tgid;
    char comm[TASK_COMM_LEN];
    char filename[256];
    u32 syscall_type;
};

struct val_t {
    u64 count;
    u64 bytes;
};

BPF_PERCPU_HASH(stats, struct key_t, struct val_t, 10240);
BPF_PERCPU_ARRAY(lost, u64, 1);

static inline int get_path_from_file(struct file *file, char *buf, int buflen) {
    struct dentry *dentry;
    struct vfsmount *mnt;
    struct path path;
    char *ret;

    if (!file)
        return -1;

    dentry = file->f_path.dentry;
    mnt = file->f_path.mnt;
    if (!dentry || !mnt)
        return -1;

    path.dentry = dentry;
    path.mnt = mnt;

    ret = d_path(&path, buf, buflen);
    if (IS_ERR(ret))
        return -1;

    return 0;
}

static inline void update_stats(u32 tgid, const char *comm, const char *filename, u32 syscall_type, u64 bytes) {
    struct key_t key = {};
    key.tgid = tgid;
    __builtin_memcpy(key.comm, comm, TASK_COMM_LEN);
    __builtin_memcpy(key.filename, filename, 256);
    key.syscall_type = syscall_type;

    struct val_t *valp, zero = {};
    valp = stats.lookup_or_try_init(&key, &zero);
    if (valp) {
        valp->count++;
        valp->bytes += bytes;
    } else {
        u64 *lost_count = lost.lookup((u32[]){0});
        if (lost_count)
            (*lost_count)++;
    }
}

TRACEPOINT_PROBE(syscalls, sys_enter_open) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 tgid = pid_tgid & 0xFFFFFFFF;
    char comm[TASK_COMM_LEN];
    bpf_get_current_comm(&comm, sizeof(comm));
    char filename[256];
    const char __user *fn = (const char __user *)args->filename;
    bpf_probe_read_user_str(&filename, sizeof(filename), fn);
    update_stats(tgid, comm, filename, 0, 0);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_openat) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 tgid = pid_tgid & 0xFFFFFFFF;
    char comm[TASK_COMM_LEN];
    bpf_get_current_comm(&comm, sizeof(comm));
    char filename[256];
    const char __user *fn = (const char __user *)args->filename;
    bpf_probe_read_user_str(&filename, sizeof(filename), fn);
    update_stats(tgid, comm, filename, 0, 0);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_read) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 tgid = pid_tgid & 0xFFFFFFFF;
    char comm[TASK_COMM_LEN];
    bpf_get_current_comm(&comm, sizeof(comm));
    char filename[256] = "unknown";

    struct file *file = (struct file *)bpf_get_current_task()->files->fdt->fd[args->fd];
    if (file) {
        char buf[256];
        if (get_path_from_file(file, buf, sizeof(buf)) == 0) {
            bpf_probe_read_kernel_str(&filename, sizeof(filename), buf);
        }
    }
    update_stats(tgid, comm, filename, 1, args->count);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_write) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 tgid = pid_tgid & 0xFFFFFFFF;
    char comm[TASK_COMM_LEN];
    bpf_get_current_comm(&comm, sizeof(comm));
    char filename[256] = "unknown";

    struct file *file = (struct file *)bpf_get_current_task()->files->fdt->fd[args->fd];
    if (file) {
        char buf[256];
        if (get_path_from_file(file, buf, sizeof(buf)) == 0) {
            bpf_probe_read_kernel_str(&filename, sizeof(filename), buf);
        }
    }
    update_stats(tgid, comm, filename, 2, args->count);
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_close) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 tgid = pid_tgid & 0xFFFFFFFF;
    char comm[TASK_COMM_LEN];
    bpf_get_current_comm(&comm, sizeof(comm));
    char filename[256] = "unknown";

    struct file *file = (struct file *)bpf_get_current_task()->files->fdt->fd[args->fd];
    if (file) {
        char buf[256];
        if (get_path_from_file(file, buf, sizeof(buf)) == 0) {
            bpf_probe_read_kernel_str(&filename, sizeof(filename), buf);
        }
    }
    update_stats(tgid, comm, filename, 3, 0);
    return 0;
}
"""


SYSCALL_TYPES = {
    0: "open",
    1: "read",
    2: "write",
    3: "close",
}


class Key(ctypes.Structure):
    _fields_ = [
        ("tgid", ctypes.c_uint32),
        ("comm", ctypes.c_char * 16),
        ("filename", ctypes.c_char * 256),
        ("syscall_type", ctypes.c_uint32),
    ]


class Val(ctypes.Structure):
    _fields_ = [
        ("count", ctypes.c_uint64),
        ("bytes", ctypes.c_uint64),
    ]


class BPFWrapper:
    def __init__(self, perf_buffer_pages: int = 1024):
        self.bpf: Optional[BPF] = None
        self._running = False
        self._container_pidns: Dict[str, int] = {}
        self._perf_buffer_pages = perf_buffer_pages

    def set_container_pidns(self, container_id: str, pidns: int):
        self._container_pidns[container_id] = pidns

    def remove_container_pidns(self, container_id: str):
        self._container_pidns.pop(container_id, None)

    def _is_tgid_in_container(self, tgid: int, container_id: str) -> bool:
        try:
            pidns_path = f"/proc/{tgid}/ns/pid"
            if not os.path.exists(pidns_path):
                return False
            pidns = os.stat(pidns_path).st_ino
            return pidns == self._container_pidns.get(container_id, -1)
        except Exception:
            return False

    def load(self):
        if self.bpf is None:
            self.bpf = BPF(text=BPF_PROGRAM)

    def attach(self):
        if self.bpf and not self._running:
            self._running = True

    def detach(self):
        if self.bpf and self._running:
            self._running = False

    def collect_stats(self, container_id: str) -> Dict[str, Dict[str, Dict[str, int]]]:
        if not self.bpf:
            return {}

        aggregated: Dict[str, Dict[str, Dict[str, int]]] = defaultdict(lambda: defaultdict(lambda: {"count": 0, "bytes": 0}))
        stats_map = self.bpf["stats"]

        for key, val in stats_map.items():
            if self._is_tgid_in_container(key.tgid, container_id):
                comm = key.comm.decode("utf-8", errors="replace").strip("\x00")
                filename = key.filename.decode("utf-8", errors="replace").strip("\x00")
                syscall_type = SYSCALL_TYPES.get(key.syscall_type, "unknown")

                file_key = f"{comm}||{filename}"
                aggregated[file_key][syscall_type]["count"] += val.count
                aggregated[file_key][syscall_type]["bytes"] += val.bytes

        return aggregated

    def get_and_reset_lost(self) -> int:
        if not self.bpf:
            return 0
        lost_map = self.bpf["lost"]
        total_lost = 0
        for i in range(lost_map.leaf_size):
            try:
                val = lost_map[i]
                total_lost += val.value
            except Exception:
                pass
        return total_lost

    def clear_stats(self):
        if self.bpf:
            self.bpf["stats"].clear()

    def unload(self):
        if self.bpf:
            try:
                self.bpf.cleanup()
            except Exception:
                pass
            self.bpf = None
            self._running = False
