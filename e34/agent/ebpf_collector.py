#!/usr/bin/env python3
from bcc import BPF
import ctypes as ct
import time
import socket
import struct
import psutil
import requests
import os
from dotenv import load_dotenv
from collections import defaultdict

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
REPORT_INTERVAL = int(os.getenv("REPORT_INTERVAL", "5"))

bpf_text = """
#include <uapi/linux/ptrace.h>
#include <net/sock.h>
#include <bcc/proto.h>
#include <linux/tcp.h>
#include <linux/ip.h>
#include <linux/in.h>

struct conn_event_t {
    u32 pid;
    u32 saddr;
    u32 daddr;
    u16 sport;
    u16 dport;
    u8 proto;
    u64 timestamp;
};

BPF_PERF_OUTPUT(conn_events);

int trace_tcp_connect(struct pt_regs *ctx, struct sock *sk) {
    struct conn_event_t event = {};
    u16 dport = sk->__sk_common.skc_dport;
    u32 daddr = sk->__sk_common.skc_daddr;
    u32 saddr = sk->__sk_common.skc_rcv_saddr;
    u16 sport = sk->__sk_common.skc_num;
    
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.saddr = saddr;
    event.daddr = daddr;
    event.sport = sport;
    event.dport = ntohs(dport);
    event.proto = IPPROTO_TCP;
    event.timestamp = bpf_ktime_get_ns();
    
    conn_events.perf_submit(ctx, &event, sizeof(event));
    return 0;
}

int trace_udp_sendmsg(struct pt_regs *ctx, struct sock *sk) {
    struct conn_event_t event = {};
    u16 dport = sk->__sk_common.skc_dport;
    u32 daddr = sk->__sk_common.skc_daddr;
    u32 saddr = sk->__sk_common.skc_rcv_saddr;
    u16 sport = sk->__sk_common.skc_num;
    
    if (dport == 0 || daddr == 0) return 0;
    
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.saddr = saddr;
    event.daddr = daddr;
    event.sport = sport;
    event.dport = ntohs(dport);
    event.proto = IPPROTO_UDP;
    event.timestamp = bpf_ktime_get_ns();
    
    conn_events.perf_submit(ctx, &event, sizeof(event));
    return 0;
}
"""

class ConnEvent(ct.Structure):
    _fields_ = [
        ("pid", ct.c_uint),
        ("saddr", ct.c_uint),
        ("daddr", ct.c_uint),
        ("sport", ct.c_ushort),
        ("dport", ct.c_ushort),
        ("proto", ct.c_ubyte),
        ("timestamp", ct.c_ulonglong),
    ]

def int_to_ip(addr):
    return socket.inet_ntoa(struct.pack("I", addr))

def get_process_info(pid):
    try:
        proc = psutil.Process(pid)
        return {
            "pid": pid,
            "name": proc.name(),
            "cmdline": " ".join(proc.cmdline()) if proc.cmdline() else "",
        }
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return {"pid": pid, "name": "unknown", "cmdline": ""}

def get_service_name(port):
    try:
        return socket.getservbyport(port)
    except (OSError, socket.error):
        return f"port_{port}"

connection_stats = defaultdict(lambda: {"count": 0, "bytes": 0})

def handle_event(cpu, data, size):
    event = ct.cast(data, ct.POINTER(ConnEvent)).contents
    saddr = int_to_ip(event.saddr)
    daddr = int_to_ip(event.daddr)
    proto = "TCP" if event.proto == 6 else "UDP"
    
    src_proc = get_process_info(event.pid)
    
    key = (saddr, event.sport, daddr, event.dport, proto)
    connection_stats[key]["count"] += 1
    connection_stats[key]["src_proc"] = src_proc
    connection_stats[key]["timestamp"] = time.time()

def report_connections():
    connections = []
    for (saddr, sport, daddr, dport, proto), stats in connection_stats.items():
        src_service = stats["src_proc"]["name"]
        dst_service = get_service_name(dport)
        
        connections.append({
            "src_ip": saddr,
            "src_port": sport,
            "src_service": src_service,
            "dst_ip": daddr,
            "dst_port": dport,
            "dst_service": dst_service,
            "protocol": proto,
            "count": stats["count"],
            "timestamp": stats["timestamp"],
            "src_pid": stats["src_proc"]["pid"],
        })
    
    if connections:
        try:
            response = requests.post(f"{BACKEND_URL}/api/connections", json=connections, timeout=5)
            print(f"Reported {len(connections)} connections, status: {response.status_code}")
        except Exception as e:
            print(f"Failed to report connections: {e}")
    
    connection_stats.clear()

def main():
    print("Starting eBPF service topology collector...")
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Report interval: {REPORT_INTERVAL}s")
    
    b = BPF(text=bpf_text)
    
    b.attach_kprobe(event="tcp_v4_connect", fn_name="trace_tcp_connect")
    b.attach_kprobe(event="tcp_v6_connect", fn_name="trace_tcp_connect")
    b.attach_kprobe(event="udp_sendmsg", fn_name="trace_udp_sendmsg")
    
    b["conn_events"].open_perf_buffer(handle_event)
    
    last_report = time.time()
    
    while True:
        try:
            b.perf_buffer_poll(timeout=100)
            
            current_time = time.time()
            if current_time - last_report >= REPORT_INTERVAL:
                report_connections()
                last_report = current_time
                
        except KeyboardInterrupt:
            print("\nStopping collector...")
            break
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(1)

if __name__ == "__main__":
    main()
