package xdr

import (
	"bytes"
	"testing"
)

func TestUint32(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)

	expected := uint32(0xDEADBEEF)
	if err := w.WriteUint32(expected); err != nil {
		t.Fatalf("WriteUint32 failed: %v", err)
	}

	r := NewReader(&buf)
	got, err := r.ReadUint32()
	if err != nil {
		t.Fatalf("ReadUint32 failed: %v", err)
	}

	if got != expected {
		t.Errorf("Uint32 mismatch: got %x, want %x", got, expected)
	}
}

func TestUint64(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)

	expected := uint64(0xDEADBEEFCAFEBABE)
	if err := w.WriteUint64(expected); err != nil {
		t.Fatalf("WriteUint64 failed: %v", err)
	}

	r := NewReader(&buf)
	got, err := r.ReadUint64()
	if err != nil {
		t.Fatalf("ReadUint64 failed: %v", err)
	}

	if got != expected {
		t.Errorf("Uint64 mismatch: got %x, want %x", got, expected)
	}
}

func TestOpaque(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)

	expected := []byte("hello world xdr test")
	if err := w.WriteOpaque(expected); err != nil {
		t.Fatalf("WriteOpaque failed: %v", err)
	}

	r := NewReader(&buf)
	got, err := r.ReadOpaque()
	if err != nil {
		t.Fatalf("ReadOpaque failed: %v", err)
	}

	if !bytes.Equal(got, expected) {
		t.Errorf("Opaque mismatch: got %s, want %s", got, expected)
	}
}

func TestString(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)

	expected := "test string with unicode: 中文测试"
	if err := w.WriteString(expected); err != nil {
		t.Fatalf("WriteString failed: %v", err)
	}

	r := NewReader(&buf)
	got, err := r.ReadString()
	if err != nil {
		t.Fatalf("ReadString failed: %v", err)
	}

	if got != expected {
		t.Errorf("String mismatch: got %s, want %s", got, expected)
	}
}

func TestBool(t *testing.T) {
	tests := []bool{true, false, true, false}

	for _, expected := range tests {
		var buf bytes.Buffer
		w := NewWriter(&buf)

		if err := w.WriteBool(expected); err != nil {
			t.Fatalf("WriteBool failed: %v", err)
		}

		r := NewReader(&buf)
		got, err := r.ReadBool()
		if err != nil {
			t.Fatalf("ReadBool failed: %v", err)
		}

		if got != expected {
			t.Errorf("Bool mismatch: got %v, want %v", got, expected)
		}
	}
}

func TestOpaqueAuth(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)

	expected := &OpaqueAuth{
		Flavor: 1,
		Body:   []byte("auth body"),
	}

	if err := expected.EncodeXDR(w); err != nil {
		t.Fatalf("EncodeXDR failed: %v", err)
	}

	r := NewReader(&buf)
	got := &OpaqueAuth{}
	if err := got.DecodeXDR(r); err != nil {
		t.Fatalf("DecodeXDR failed: %v", err)
	}

	if got.Flavor != expected.Flavor {
		t.Errorf("Flavor mismatch: got %d, want %d", got.Flavor, expected.Flavor)
	}

	if !bytes.Equal(got.Body, expected.Body) {
		t.Errorf("Body mismatch: got %s, want %s", got.Body, expected.Body)
	}
}

func TestMarshalUnmarshal(t *testing.T) {
	auth := &OpaqueAuth{
		Flavor: 123,
		Body:   []byte("test body for marshal"),
	}

	data, err := Marshal(auth)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	got := &OpaqueAuth{}
	if err := Unmarshal(data, got); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if got.Flavor != auth.Flavor {
		t.Errorf("Flavor mismatch: got %d, want %d", got.Flavor, auth.Flavor)
	}

	if !bytes.Equal(got.Body, auth.Body) {
		t.Errorf("Body mismatch: got %s, want %s", got.Body, auth.Body)
	}
}
