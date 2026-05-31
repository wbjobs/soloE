#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "Dual BSD/GPL";

struct func_stats {
    __u64 count;
    __u64 total_ns;
    __u64 min_ns;
    __u64 max_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);
    __type(value, struct func_stats);
} stats_map SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u64);
    __type(value, __u64);
} start_times SEC(".maps");

static __always_inline __u64 get_func_id() {
    return 0;
}

SEC("uprobe")
int BPF_KPROBE(servehttp_entry) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 start_time = bpf_ktime_get_ns();
    
    bpf_map_update_elem(&start_times, &pid_tgid, &start_time, BPF_ANY);
    return 0;
}

SEC("uretprobe")
int BPF_KRETPROBE(servehttp_exit) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u64 *start_time = bpf_map_lookup_elem(&start_times, &pid_tgid);
    
    if (!start_time) {
        return 0;
    }
    
    __u64 end_time = bpf_ktime_get_ns();
    __u64 duration = end_time - *start_time;
    
    __u32 func_id = 0;
    struct func_stats *stats = bpf_map_lookup_elem(&stats_map, &func_id);
    
    if (stats) {
        __sync_fetch_and_add(&stats->count, 1);
        __sync_fetch_and_add(&stats->total_ns, duration);
        
        if (duration < stats->min_ns || stats->min_ns == 0) {
            stats->min_ns = duration;
        }
        if (duration > stats->max_ns) {
            stats->max_ns = duration;
        }
    } else {
        struct func_stats new_stats = {
            .count = 1,
            .total_ns = duration,
            .min_ns = duration,
            .max_ns = duration
        };
        bpf_map_update_elem(&stats_map, &func_id, &new_stats, BPF_ANY);
    }
    
    bpf_map_delete_elem(&start_times, &pid_tgid);
    return 0;
}
