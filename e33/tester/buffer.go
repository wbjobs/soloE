package tester

import (
	"bytes"
	"sync"
)

type BufferPool struct {
	pool sync.Pool
}

func NewBufferPool() *BufferPool {
	return &BufferPool{
		pool: sync.Pool{
			New: func() interface{} {
				return bytes.NewBuffer(make([]byte, 0, 32*1024))
			},
		},
	}
}

func (bp *BufferPool) Get() *bytes.Buffer {
	buf := bp.pool.Get().(*bytes.Buffer)
	buf.Reset()
	return buf
}

func (bp *BufferPool) Put(buf *bytes.Buffer) {
	bp.pool.Put(buf)
}

type DiscardReader struct{}

func (d *DiscardReader) Write(p []byte) (n int, err error) {
	return len(p), nil
}

var globalDiscard = &DiscardReader{}

func GetDiscard() *DiscardReader {
	return globalDiscard
}
