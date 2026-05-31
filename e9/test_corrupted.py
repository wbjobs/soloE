#!/usr/bin/env python3
import sys
from collections import Counter
from scapy.all import rdpcap, IP, TCP, UDP, ICMP, ARP


class CorruptedPacket:
    """模拟一个损坏的数据包，访问时会抛出异常"""
    def __init__(self):
        pass
    
    def __contains__(self, item):
        raise Exception("Corrupted packet: unable to parse")


def test_corrupted_packet_handling():
    print("测试损坏数据包处理...")
    
    protocol_counts = Counter()
    corrupted_packets = 0
    
    test_packets = [
        Ether() / IP(src="192.168.1.1", dst="8.8.8.8") / TCP(dport=80),
        CorruptedPacket(),
        Ether() / IP(src="192.168.1.2", dst="8.8.8.8") / UDP(dport=53),
        CorruptedPacket(),
        Ether() / IP(src="192.168.1.3", dst="8.8.8.8") / ICMP(),
    ]
    
    print(f"总测试数据包: {len(test_packets)}")
    
    for pkt in test_packets:
        try:
            if IP in pkt:
                src_ip = pkt[IP].src
                dst_ip = pkt[IP].dst
                if TCP in pkt:
                    protocol_counts['TCP'] += 1
                elif UDP in pkt:
                    protocol_counts['UDP'] += 1
                elif ICMP in pkt:
                    protocol_counts['ICMP'] += 1
            elif ARP in pkt:
                protocol_counts['ARP'] += 1
        except Exception as e:
            corrupted_packets += 1
            print(f"  跳过损坏数据包: {e}")
            continue
    
    print(f"成功处理: {len(test_packets) - corrupted_packets} 个数据包")
    print(f"损坏跳过: {corrupted_packets} 个数据包")
    print(f"协议统计: {dict(protocol_counts)}")
    
    if corrupted_packets == 2:
        print("\n✓ 损坏数据包处理测试通过!")
        return True
    else:
        print("\n✗ 测试失败!")
        return False


if __name__ == "__main__":
    from scapy.all import Ether
    test_corrupted_packet_handling()