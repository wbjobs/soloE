package common

import (
	"bytes"
	"testing"
)

func TestBrotliCompression(t *testing.T) {
	original := []byte("Hello, QUIC Proxy! This is a test message for Brotli compression.")

	compressed, err := CompressBrotli(original)
	if err != nil {
		t.Fatalf("CompressBrotli failed: %v", err)
	}

	decompressed, err := DecompressBrotli(compressed)
	if err != nil {
		t.Fatalf("DecompressBrotli failed: %v", err)
	}

	if !bytes.Equal(original, decompressed) {
		t.Errorf("Decompressed data mismatch: expected %s, got %s", original, decompressed)
	}

	t.Logf("Original: %d bytes, Compressed: %d bytes, Ratio: %.2f%%",
		len(original), len(compressed), float64(len(compressed))/float64(len(original))*100)
}

func TestWebSocketFrame(t *testing.T) {
	frame := &WebSocketFrame{
		Opcode:  WSFrameBinary,
		Payload: []byte("Test WebSocket message"),
	}

	encoded, err := EncodeWebSocketFrame(frame)
	if err != nil {
		t.Fatalf("EncodeWebSocketFrame failed: %v", err)
	}

	decoded, err := DecodeWebSocketFrame(bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("DecodeWebSocketFrame failed: %v", err)
	}

	if decoded.Opcode != frame.Opcode {
		t.Errorf("Opcode mismatch: expected %d, got %d", frame.Opcode, decoded.Opcode)
	}

	if !bytes.Equal(frame.Payload, decoded.Payload) {
		t.Errorf("Payload mismatch")
	}
}

func TestStreamStats(t *testing.T) {
	stats := NewStreamStats(1)

	stats.AddSent(1000)
	stats.AddRecv(2000)
	stats.AddSent(500)

	sent, recv, _ := stats.GetStats()
	if sent != 1500 {
		t.Errorf("Expected sent 1500, got %d", sent)
	}
	if recv != 2000 {
		t.Errorf("Expected recv 2000, got %d", recv)
	}
}

func TestConnectionStats(t *testing.T) {
	cs := NewConnectionStats()

	stats1 := cs.AddStream(1)
	stats2 := cs.AddStream(2)

	stats1.AddSent(100)
	stats1.AddRecv(200)
	stats2.AddSent(300)
	stats2.AddRecv(400)

	streams, totalSent, totalRecv := cs.GetTotalStats()
	if streams != 2 {
		t.Errorf("Expected 2 streams, got %d", streams)
	}
	if totalSent != 400 {
		t.Errorf("Expected total sent 400, got %d", totalSent)
	}
	if totalRecv != 600 {
		t.Errorf("Expected total recv 600, got %d", totalRecv)
	}

	cs.RemoveStream(1)
	streams, _, _ = cs.GetTotalStats()
	if streams != 1 {
		t.Errorf("Expected 1 stream after removal, got %d", streams)
	}
}
