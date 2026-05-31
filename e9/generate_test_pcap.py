#!/usr/bin/env python3
from scapy.all import Ether, IP, TCP, UDP, ICMP, ARP, wrpcap, RandIP


def generate_test_pcap(filename="test.pcap", num_packets=50):
    packets = []
    
    for i in range(num_packets):
        if i % 5 == 0:
            pkt = Ether() / IP(src="192.168.1.100", dst="8.8.8.8") / TCP(dport=80)
        elif i % 5 == 1:
            pkt = Ether() / IP(src="192.168.1.100", dst="8.8.4.4") / UDP(dport=53)
        elif i % 5 == 2:
            pkt = Ether() / IP(src="192.168.1.101", dst="192.168.1.100") / ICMP()
        elif i % 5 == 3:
            pkt = Ether() / ARP(psrc="192.168.1.1", pdst="192.168.1.100")
        else:
            pkt = Ether() / IP(src="10.0.0.1", dst="192.168.1.100") / TCP(dport=443)
        
        packets.append(pkt)
    
    wrpcap(filename, packets)
    print(f"Generated test pcap file: {filename} with {num_packets} packets")


if __name__ == "__main__":
    generate_test_pcap()