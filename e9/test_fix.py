#!/usr/bin/env python3
import os
from scapy.all import Ether, IP, TCP, UDP, ICMP, wrpcap, Raw


def generate_corrupted_pcap(filename="corrupted_test.pcap"):
    packets = []
    
    for i in range(10):
        pkt = Ether() / IP(src=f"192.168.1.{i+1}", dst="8.8.8.8") / TCP(dport=80)
        packets.append(pkt)
    
    for i in range(5):
        pkt = Ether() / IP(src="10.0.0.1", dst="192.168.1.1") / UDP(dport=53)
        packets.append(pkt)
    
    wrpcap(filename, packets)
    
    with open(filename, "rb") as f:
        data = f.read()
    
    corrupted_data = data[:len(data)//2] + b'\x00' * 100 + data[len(data)//2+100:]
    
    with open(filename, "wb") as f:
        f.write(corrupted_data)
    
    print(f"Generated potentially corrupted pcap file: {filename}")


def test_normal_pcap():
    print("Testing with normal pcap file...")
    os.system("python net_analyzer.py test.pcap")


if __name__ == "__main__":
    test_normal_pcap()