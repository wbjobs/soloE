package common

import (
	"bytes"
	"sync"

	"github.com/andybalholm/brotli"
)

func CompressBrotli(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	writer := brotli.NewWriterLevel(&buf, brotli.DefaultCompression)
	_, err := writer.Write(data)
	if err != nil {
		return nil, err
	}
	err = writer.Close()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func DecompressBrotli(compressedData []byte) ([]byte, error) {
	reader := brotli.NewReader(bytes.NewReader(compressedData))
	var buf bytes.Buffer
	_, err := buf.ReadFrom(reader)
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
