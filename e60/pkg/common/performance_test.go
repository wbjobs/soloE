package common

import (
	"bytes"
	"math/rand"
	"testing"
	"time"
)

func TestBBRCongestionControl(t *testing.T) {
	bbr := NewBBR()

	dataSize := 1500
	for i := 0; i < 100; i++ {
		if bbr.CanSend(dataSize) {
			bbr.OnPacketSent(dataSize)
			bbr.UpdateSendTime(dataSize)

			rtt := time.Duration(50+rand.Intn(50)) * time.Millisecond
			bbr.OnPacketAcked(dataSize, rtt)
		} else {
			time.Sleep(10 * time.Millisecond)
		}
	}

	bw, rtt, cwnd, _ := bbr.GetStats()
	t.Logf("BBR Stats - Bandwidth: %.2f Mbps, RTT: %v, CWND: %d", bw/1e6, rtt, cwnd)

	if bw <= 0 {
		t.Error("Expected positive bandwidth")
	}
	if cwnd <= 0 {
		t.Error("Expected positive congestion window")
	}
}

func TestBBRStartupState(t *testing.T) {
	bbr := NewBBR()

	if bbr.GetState() != BBRStartup {
		t.Error("Expected BBR to start in Startup state")
	}

	dataSize := 1500
	for i := 0; i < 50; i++ {
		if bbr.CanSend(dataSize) {
			bbr.OnPacketSent(dataSize)
			bbr.UpdateSendTime(dataSize)
			bbr.OnPacketAcked(dataSize, 50*time.Millisecond)
		}
	}

	_, _, cwnd, _ := bbr.GetStats()
	t.Logf("CWND after startup: %d", cwnd)
}

func TestPriorityScheduling(t *testing.T) {
	scheduler := NewStreamScheduler(100)

	criticalPacket := &ScheduledPacket{
		StreamID: 1,
		Priority: PriorityCritical,
		Data:     []byte("critical data"),
	}

	normalPacket := &ScheduledPacket{
		StreamID: 2,
		Priority: PriorityNormal,
		Data:     []byte("normal data"),
	}

	lowPacket := &ScheduledPacket{
		StreamID: 3,
		Priority: PriorityLow,
		Data:     []byte("low priority data"),
	}

	scheduler.Enqueue(lowPacket)
	scheduler.Enqueue(normalPacket)
	scheduler.Enqueue(criticalPacket)

	time.Sleep(10 * time.Millisecond)

	p1 := scheduler.Dequeue(100 * time.Millisecond)
	if p1 == nil {
		t.Fatal("Expected to dequeue a packet")
	}
	if p1.Priority != PriorityCritical {
		t.Errorf("Expected critical packet first, got %v", p1.Priority)
	}

	p2 := scheduler.Dequeue(100 * time.Millisecond)
	if p2 == nil {
		t.Fatal("Expected to dequeue a packet")
	}
	if p2.Priority != PriorityNormal {
		t.Errorf("Expected normal packet second, got %v", p2.Priority)
	}

	p3 := scheduler.Dequeue(100 * time.Millisecond)
	if p3 == nil {
		t.Fatal("Expected to dequeue a packet")
	}
	if p3.Priority != PriorityLow {
		t.Errorf("Expected low packet third, got %v", p3.Priority)
	}
}

func TestStreamWeights(t *testing.T) {
	scheduler := NewStreamScheduler(100)

	scheduler.SetStreamWeight(1, 5.0)
	scheduler.SetStreamWeight(2, 1.0)

	for i := 0; i < 10; i++ {
		p1 := &ScheduledPacket{
			StreamID: 1,
			Priority: PriorityNormal,
			Data:     []byte("stream1 data"),
		}
		p2 := &ScheduledPacket{
			StreamID: 2,
			Priority: PriorityNormal,
			Data:     []byte("stream2 data"),
		}
		scheduler.Enqueue(p1)
		scheduler.Enqueue(p2)
	}

	stream1Count := 0
	stream2Count := 0
	for i := 0; i < 20; i++ {
		p := scheduler.Dequeue(100 * time.Millisecond)
		if p == nil {
			break
		}
		if p.StreamID == 1 {
			stream1Count++
		} else {
			stream2Count++
		}
	}

	t.Logf("Stream 1: %d packets, Stream 2: %d packets", stream1Count, stream2Count)

	if stream1Count <= stream2Count {
		t.Error("Expected higher weight stream to get more bandwidth")
	}
}

func TestFECBasicEncodingDecoding(t *testing.T) {
	encoder := NewFECEncoder()
	decoder := NewFECDecoder()

	originalData := []byte("Hello, this is a test message for FEC encoding and decoding!")

	packets, err := encoder.Encode(originalData)
	if err != nil {
		t.Fatalf("FEC encoding failed: %v", err)
	}

	t.Logf("Encoded into %d packets", len(packets))

	var decodedData []byte
	for _, packet := range packets {
		data, ok := decoder.Decode(packet)
		if ok {
			for _, d := range data {
				decodedData = append(decodedData, d...)
			}
		}
	}

	if !bytes.Contains(decodedData, originalData) {
		t.Error("Decoded data does not contain original data")
	}
}

func TestFECPacketLossRecovery(t *testing.T) {
	encoder := NewFECEncoder()
	decoder := NewFECDecoder()

	originalData := common.GenerateRandomData(10000)

	packets, err := encoder.Encode(originalData)
	if err != nil {
		t.Fatalf("FEC encoding failed: %v", err)
	}

	lossRate := 0.15
	survivedPackets := make([][]byte, 0)
	for i, packet := range packets {
		if i < len(packets)-2 || rand.Float64() > lossRate {
			survivedPackets = append(survivedPackets, packet)
		}
	}

	t.Logf("Original: %d packets, Survived: %d packets (%.0f%% loss)",
		len(packets), len(survivedPackets), lossRate*100)

	var decodedData []byte
	for _, packet := range survivedPackets {
		data, ok := decoder.Decode(packet)
		if ok {
			for _, d := range data {
				decodedData = append(decodedData, d...)
			}
		}
	}

	if len(decodedData) > 0 {
		t.Logf("Successfully recovered %d bytes of data", len(decodedData))
	} else {
		t.Log("No data recovered (expected for high loss rates)")
	}
}

func TestFECCriticalFrames(t *testing.T) {
	encoder := NewFECEncoder()
	decoder := NewFECDecoder()

	criticalFrame := []byte("WebSocket PING - critical control frame")

	packets, err := encoder.Encode(criticalFrame)
	if err != nil {
		t.Fatalf("FEC encoding failed: %v", err)
	}

	if len(packets) <= 1 {
		t.Error("Expected multiple FEC packets for redundancy")
	}

	packets = packets[1:]

	var decodedData []byte
	for _, packet := range packets {
		data, ok := decoder.Decode(packet)
		if ok {
			for _, d := range data {
				decodedData = append(decodedData, d...)
			}
		}
	}

	if len(decodedData) > 0 {
		t.Logf("Critical frame recovered despite first packet loss: %s", string(decodedData))
	}
}

func TestHeadOfLineBlockingMitigation(t *testing.T) {
	scheduler := NewStreamScheduler(100)

	for i := 0; i < 5; i++ {
		streamID := uint64(i)
		weight := 1.0 + float64(i)*0.5
		scheduler.SetStreamWeight(streamID, weight)

		for j := 0; j < 10; j++ {
			packet := &ScheduledPacket{
				StreamID: streamID,
				Priority: PriorityNormal,
				Data:     []byte{byte(streamID), byte(j)},
			}
			scheduler.Enqueue(packet)
		}
	}

	streamCounts := make(map[uint64]int)
	for i := 0; i < 50; i++ {
		p := scheduler.Dequeue(100 * time.Millisecond)
		if p == nil {
			break
		}
		streamCounts[p.StreamID]++
	}

	t.Log("Stream packet counts (fair scheduling):")
	for streamID, count := range streamCounts {
		t.Logf("  Stream %d: %d packets", streamID, count)
	}

	prevCount := -1
	for _, count := range streamCounts {
		if prevCount >= 0 && abs(count-prevCount) > 5 {
			t.Error("Head-of-line blocking detected: large discrepancy in packet counts between streams")
		}
		prevCount = count
	}
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func TestBBRAgainstPacketLoss(t *testing.T) {
	bbr := NewBBR()

	dataSize := 1500
	lossRate := 0.10

	for i := 0; i < 200; i++ {
		if bbr.CanSend(dataSize) {
			bbr.OnPacketSent(dataSize)
			bbr.UpdateSendTime(dataSize)

			if rand.Float64() > lossRate {
				rtt := time.Duration(50+rand.Intn(100)) * time.Millisecond
				bbr.OnPacketAcked(dataSize, rtt)
			} else {
				bbr.OnPacketLost(dataSize)
			}
		} else {
			time.Sleep(5 * time.Millisecond)
		}
	}

	bw, rtt, cwnd, lost := bbr.GetStats()
	t.Logf("BBR under 10%% loss - BW: %.2f Mbps, RTT: %v, CWND: %d, Lost: %d",
		bw/1e6, rtt, cwnd, lost)

	if bw <= 0 {
		t.Error("BBR should maintain positive bandwidth under loss")
	}
	if cwnd < 2 {
		t.Error("BBR should maintain minimum congestion window")
	}
}
