package xdr

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

var (
	ErrUnexpectedEOF = errors.New("unexpected EOF while reading XDR data")
	ErrOverflow      = errors.New("XDR data overflow")
)

type Reader struct {
	r io.Reader
}

type Writer struct {
	w io.Writer
}

func NewReader(r io.Reader) *Reader {
	return &Reader{r: r}
}

func NewWriter(w io.Writer) *Writer {
	return &Writer{w: w}
}

func (r *Reader) ReadUint32() (uint32, error) {
	buf := make([]byte, 4)
	if _, err := io.ReadFull(r.r, buf); err != nil {
		return 0, ErrUnexpectedEOF
	}
	return binary.BigEndian.Uint32(buf), nil
}

func (r *Reader) ReadUint64() (uint64, error) {
	buf := make([]byte, 8)
	if _, err := io.ReadFull(r.r, buf); err != nil {
		return 0, ErrUnexpectedEOF
	}
	return binary.BigEndian.Uint64(buf), nil
}

func (r *Reader) ReadInt32() (int32, error) {
	v, err := r.ReadUint32()
	return int32(v), err
}

func (r *Reader) ReadInt64() (int64, error) {
	v, err := r.ReadUint64()
	return int64(v), err
}

func (r *Reader) ReadBool() (bool, error) {
	v, err := r.ReadUint32()
	return v != 0, err
}

func (r *Reader) ReadOpaque() ([]byte, error) {
	length, err := r.ReadUint32()
	if err != nil {
		return nil, err
	}
	if length > 1<<30 {
		return nil, ErrOverflow
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(r.r, buf); err != nil {
		return nil, ErrUnexpectedEOF
	}
	pad := (4 - length%4) % 4
	if pad > 0 {
		padBuf := make([]byte, pad)
		if _, err := io.ReadFull(r.r, padBuf); err != nil {
			return nil, ErrUnexpectedEOF
		}
	}
	return buf, nil
}

func (r *Reader) ReadString() (string, error) {
	b, err := r.ReadOpaque()
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (r *Reader) ReadFixedOpaque(length uint32) ([]byte, error) {
	buf := make([]byte, length)
	if _, err := io.ReadFull(r.r, buf); err != nil {
		return nil, ErrUnexpectedEOF
	}
	pad := (4 - length%4) % 4
	if pad > 0 {
		padBuf := make([]byte, pad)
		if _, err := io.ReadFull(r.r, padBuf); err != nil {
			return nil, ErrUnexpectedEOF
		}
	}
	return buf, nil
}

func (r *Reader) ReadBytes(n int) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := io.ReadFull(r.r, buf); err != nil {
		return nil, ErrUnexpectedEOF
	}
	return buf, nil
}

func (w *Writer) WriteUint32(v uint32) error {
	buf := make([]byte, 4)
	binary.BigEndian.PutUint32(buf, v)
	_, err := w.w.Write(buf)
	return err
}

func (w *Writer) WriteUint64(v uint64) error {
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, v)
	_, err := w.w.Write(buf)
	return err
}

func (w *Writer) WriteInt32(v int32) error {
	return w.WriteUint32(uint32(v))
}

func (w *Writer) WriteInt64(v int64) error {
	return w.WriteUint64(uint64(v))
}

func (w *Writer) WriteBool(v bool) error {
	if v {
		return w.WriteUint32(1)
	}
	return w.WriteUint32(0)
}

func (w *Writer) WriteOpaque(b []byte) error {
	length := uint32(len(b))
	if err := w.WriteUint32(length); err != nil {
		return err
	}
	if _, err := w.w.Write(b); err != nil {
		return err
	}
	pad := (4 - length%4) % 4
	if pad > 0 {
		padBuf := make([]byte, pad)
		_, err := w.w.Write(padBuf)
		return err
	}
	return nil
}

func (w *Writer) WriteString(s string) error {
	return w.WriteOpaque([]byte(s))
}

func (w *Writer) WriteFixedOpaque(b []byte) error {
	if _, err := w.w.Write(b); err != nil {
		return err
	}
	length := uint32(len(b))
	pad := (4 - length%4) % 4
	if pad > 0 {
		padBuf := make([]byte, pad)
		_, err := w.w.Write(padBuf)
		return err
	}
	return nil
}

type Encoder interface {
	EncodeXDR(*Writer) error
}

type Decoder interface {
	DecodeXDR(*Reader) error
}

func Marshal(v Encoder) ([]byte, error) {
	var buf bytes.Buffer
	w := NewWriter(&buf)
	if err := v.EncodeXDR(w); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func Unmarshal(data []byte, v Decoder) error {
	r := NewReader(bytes.NewReader(data))
	return v.DecodeXDR(r)
}

type OpaqueAuth struct {
	Flavor uint32
	Body   []byte
}

func (o *OpaqueAuth) DecodeXDR(r *Reader) error {
	var err error
	if o.Flavor, err = r.ReadUint32(); err != nil {
		return err
	}
	if o.Body, err = r.ReadOpaque(); err != nil {
		return err
	}
	return nil
}

func (o *OpaqueAuth) EncodeXDR(w *Writer) error {
	if err := w.WriteUint32(o.Flavor); err != nil {
		return err
	}
	if err := w.WriteOpaque(o.Body); err != nil {
		return err
	}
	return nil
}

func (o *OpaqueAuth) String() string {
	return fmt.Sprintf("Auth{Flavor: %d, BodyLen: %d}", o.Flavor, len(o.Body))
}
