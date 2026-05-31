package common

import (
	"context"
	"io"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
)

type QuicConnectionWrapper struct {
	conn         quic.Connection
	bbr          *BBR
	scheduler    *StreamScheduler
	fecEncoder   *FECEncoder
	fecDecoder   *FECDecoder

	streamMutex  sync.RWMutex
	streams      map[uint64]*QuicStreamWrapper
	closed       bool
}

func NewQuicConnectionWrapper(conn quic.Connection) *QuicConnectionWrapper {
	return &QuicConnectionWrapper{
		conn:       conn,
		bbr:        NewBBR(),
		scheduler:  NewStreamScheduler(1000),
		fecEncoder: NewFECEncoder(),
		fecDecoder: NewFECDecoder(),
		streams:    make(map[uint64]*QuicStreamWrapper),
	}
}

func (w *QuicConnectionWrapper) AcceptStream(ctx context.Context) (quic.Stream, error) {
	stream, err := w.conn.AcceptStream(ctx)
	if err != nil {
		return nil, err
	}

	streamID := uint64(stream.StreamID())
	streamWrapper := NewQuicStreamWrapper(stream, w)

	w.streamMutex.Lock()
	w.streams[streamID] = streamWrapper
	w.streamMutex.Unlock()

	w.scheduler.SetStreamWeight(streamID, 1.0)

	return streamWrapper, nil
}

func (w *QuicConnectionWrapper) OpenStreamSync(ctx context.Context) (quic.Stream, error) {
	stream, err := w.conn.OpenStreamSync(ctx)
	if err != nil {
		return nil, err
	}

	streamID := uint64(stream.StreamID())
	streamWrapper := NewQuicStreamWrapper(stream, w)

	w.streamMutex.Lock()
	w.streams[streamID] = streamWrapper
	w.streamMutex.Unlock()

	w.scheduler.SetStreamWeight(streamID, 1.0)

	return streamWrapper, nil
}

func (w *QuicConnectionWrapper) CloseWithError(errCode quic.ApplicationErrorCode, errStr string) error {
	w.streamMutex.Lock()
	defer w.streamMutex.Unlock()

	if w.closed {
		return nil
	}
	w.closed = true

	w.scheduler.Close()

	for _, stream := range w.streams {
		stream.Close()
	}

	return w.conn.CloseWithError(errCode, errStr)
}

func (w *QuicConnectionWrapper) GetBBR() *BBR {
	return w.bbr
}

func (w *QuicConnectionWrapper) GetScheduler() *StreamScheduler {
	return w.scheduler
}

func (w *QuicConnectionWrapper) RemoteAddr() string {
	return w.conn.RemoteAddr().String()
}

type QuicStreamWrapper struct {
	stream     quic.Stream
	conn       *QuicConnectionWrapper
	streamID   uint64
	priority   Priority

	readMu     sync.Mutex
	writeMu    sync.Mutex

	stats      *StreamStats
}

func NewQuicStreamWrapper(stream quic.Stream, conn *QuicConnectionWrapper) *QuicStreamWrapper {
	return &QuicStreamWrapper{
		stream:    stream,
		conn:      conn,
		streamID:  uint64(stream.StreamID()),
		priority:  PriorityNormal,
		stats:     NewStreamStats(uint64(stream.StreamID())),
	}
}

func (s *QuicStreamWrapper) Read(p []byte) (n int, err error) {
	s.readMu.Lock()
	defer s.readMu.Unlock()

	n, err = s.stream.Read(p)
	if n > 0 {
		s.stats.AddRecv(n)
		s.conn.GetBBR().OnPacketAcked(n, time.Millisecond*50)
	}
	return n, err
}

func (s *QuicStreamWrapper) Write(p []byte) (n int, err error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	bbr := s.conn.GetBBR()
	if !bbr.CanSend(len(p)) {
		time.Sleep(time.Millisecond * 10)
	}

	n, err = s.stream.Write(p)
	if n > 0 {
		bbr.OnPacketSent(n)
		bbr.UpdateSendTime(n)
		s.stats.AddSent(n)
	}

	return n, err
}

func (s *QuicStreamWrapper) Close() error {
	return s.stream.Close()
}

func (s *QuicStreamWrapper) SetPriority(priority Priority) {
	s.priority = priority
	if priority == PriorityCritical {
		s.conn.GetScheduler().SetStreamWeight(s.streamID, 5.0)
	} else if priority == PriorityHigh {
		s.conn.GetScheduler().SetStreamWeight(s.streamID, 2.0)
	} else if priority == PriorityNormal {
		s.conn.GetScheduler().SetStreamWeight(s.streamID, 1.0)
	} else {
		s.conn.GetScheduler().SetStreamWeight(s.streamID, 0.5)
	}
}

func (s *QuicStreamWrapper) StreamID() quic.StreamID {
	return s.stream.StreamID()
}

func (s *QuicStreamWrapper) SetDeadline(t time.Time) error {
	return s.stream.SetDeadline(t)
}

func (s *QuicStreamWrapper) SetReadDeadline(t time.Time) error {
	return s.stream.SetReadDeadline(t)
}

func (s *QuicStreamWrapper) SetWriteDeadline(t time.Time) error {
	return s.stream.SetWriteDeadline(t)
}

func (s *QuicStreamWrapper) CancelRead(errorCode quic.StreamErrorCode) {
	s.stream.CancelRead(errorCode)
}

func (s *QuicStreamWrapper) CancelWrite(errorCode quic.StreamErrorCode) {
	s.stream.CancelWrite(errorCode)
}

func (s *QuicStreamWrapper) Context() context.Context {
	return s.stream.Context()
}

func (s *QuicStreamWrapper) GetStats() *StreamStats {
	return s.stats
}
