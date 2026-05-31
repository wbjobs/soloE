#!/usr/bin/env python3
import sys
import argparse
import re
from collections import Counter
from scapy.all import rdpcap, IP, TCP, UDP, ICMP, ARP


def apply_bpf_filter(packets, bpf_filter):
    if not bpf_filter:
        return packets
    
    try:
        filtered = []
        for pkt in packets:
            try:
                if matches_bpf(pkt, bpf_filter):
                    filtered.append(pkt)
            except Exception:
                continue
        return filtered
    except Exception as e:
        print(f"Warning: BPF filter error: {e}")
        print("Falling back to analyzing all packets.")
        return packets


def matches_bpf(pkt, bpf_filter):
    filter_expr = bpf_filter.lower().strip()
    
    has_ip = IP in pkt
    has_tcp = TCP in pkt
    has_udp = UDP in pkt
    has_arp = ARP in pkt
    
    if 'tcp' in filter_expr:
        if not has_tcp:
            return False
    
    if 'udp' in filter_expr:
        if not has_udp:
            return False
    
    if 'icmp' in filter_expr:
        if not (has_ip and ICMP in pkt):
            return False
    
    if 'arp' in filter_expr:
        if not has_arp:
            return False
    
    port_match = re.search(r'port\s+(\d+)', filter_expr)
    if port_match:
        port = int(port_match.group(1))
        if has_tcp and (pkt[TCP].sport == port or pkt[TCP].dport == port):
            pass
        elif has_udp and (pkt[UDP].sport == port or pkt[UDP].dport == port):
            pass
        else:
            return False
    
    src_match = re.search(r'src\s+host\s+([\d.]+)', filter_expr)
    if src_match and has_ip:
        src_ip = src_match.group(1)
        if pkt[IP].src != src_ip:
            return False
    
    dst_match = re.search(r'dst\s+host\s+([\d.]+)', filter_expr)
    if dst_match and has_ip:
        dst_ip = dst_match.group(1)
        if pkt[IP].dst != dst_ip:
            return False
    
    host_match = re.search(r'(?<!src\s)(?<!dst\s)host\s+([\d.]+)', filter_expr)
    if host_match and has_ip:
        host_ip = host_match.group(1)
        if pkt[IP].src != host_ip and pkt[IP].dst != host_ip:
            return False
    
    return True


def analyze_pcap(file_path, bpf_filter=None):
    try:
        packets = rdpcap(file_path)
    except Exception as e:
        print(f"Error reading pcap file: {e}")
        sys.exit(1)
    
    original_count = len(packets)
    
    if bpf_filter:
        packets = apply_bpf_filter(packets, bpf_filter)
        filtered_count = len(packets)
    else:
        filtered_count = original_count

    corrupted_packets = 0
    protocol_counts = Counter()
    ip_pairs = Counter()

    for pkt in packets:
        try:
            if IP in pkt:
                src_ip = pkt[IP].src
                dst_ip = pkt[IP].dst
                ip_pair = tuple(sorted([src_ip, dst_ip]))
                ip_pairs[ip_pair] += 1

                if TCP in pkt:
                    protocol_counts['TCP'] += 1
                elif UDP in pkt:
                    protocol_counts['UDP'] += 1
                elif ICMP in pkt:
                    protocol_counts['ICMP'] += 1
                else:
                    protocol_counts['Other IP'] += 1
            elif ARP in pkt:
                protocol_counts['ARP'] += 1
            else:
                protocol_counts['Other'] += 1
        except Exception:
            corrupted_packets += 1
            continue

    return original_count, filtered_count, corrupted_packets, protocol_counts, ip_pairs, bpf_filter


def print_table(headers, rows):
    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            col_widths[i] = max(col_widths[i], len(str(cell)))

    separator = "+" + "+".join("-" * (w + 2) for w in col_widths) + "+"
    header_row = "|" + "|".join(f" {h:<{w}} " for h, w in zip(headers, col_widths)) + "|"

    print(separator)
    print(header_row)
    print(separator)

    for row in rows:
        data_row = "|" + "|".join(f" {str(cell):<{w}} " for cell, w in zip(row, col_widths)) + "|"
        print(data_row)

    print(separator)


def main():
    parser = argparse.ArgumentParser(
        description='NET-ANALYZER - 网络抓包分析工具',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('pcap_file', help='pcap 文件路径')
    parser.add_argument('-f', '--filter', help='BPF 过滤器表达式 (例如: "tcp port 80")')
    
    args = parser.parse_args()
    file_path = args.pcap_file
    bpf_filter = args.filter

    original_count, filtered_count, corrupted_packets, protocol_counts, ip_pairs, applied_filter = analyze_pcap(file_path, bpf_filter)

    print("\n" + "=" * 60)
    print("NET-ANALYZER - 网络抓包分析工具")
    print("=" * 60)

    print(f"\n[1] 总数据包数量: {original_count}")
    if applied_filter:
        print(f"    BPF 过滤器: {applied_filter}")
        print(f"    符合过滤条件: {filtered_count} 个数据包")
    if corrupted_packets > 0:
        print(f"    其中损坏数据包: {corrupted_packets} (已跳过)\n")
    else:
        print("    无损坏数据包\n")

    display_count = filtered_count if applied_filter else original_count
    print("[2] 协议统计:")
    protocol_headers = ["协议", "数据包数量", "占比"]
    protocol_rows = []
    for proto, count in protocol_counts.most_common():
        percentage = (count / display_count * 100) if display_count > 0 else 0
        protocol_rows.append([proto, count, f"{percentage:.2f}%"])
    print_table(protocol_headers, protocol_rows)

    print("\n[3] 通信最频繁的前5个IP地址对:")
    ip_headers = ["排名", "IP地址1", "IP地址2", "数据包数量"]
    ip_rows = []
    for rank, ((ip1, ip2), count) in enumerate(ip_pairs.most_common(5), 1):
        ip_rows.append([rank, ip1, ip2, count])
    
    if ip_rows:
        print_table(ip_headers, ip_rows)
    else:
        print("未找到IP通信对")

    print("\n" + "=" * 60 + "\n")


if __name__ == "__main__":
    main()