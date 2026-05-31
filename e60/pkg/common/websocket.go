package common

import (
	"encoding/binary"
	"io"
)

const (
	WSFrameBinary  = 0x02
	WSFrameClose   = 0x08
	WSHeaderMaxSize = 14
)

type WebSocketFrame struct {
	Opcode byte
	Payload []byte
}

func EncodeWebSocketFrame(frame *WebSocketFrame) ([]byte, error) {
	payloadLen := len(frame.Payload)
	headerLen := 2
	
	if payloadLen > 125 {
		if payloadLen <= 65535 {
			headerLen += 2
		} else {
			headerLen += 8
		}
	}
	
	buf := make([]byte, headerLen)
	buf[0] = 0x80 | frame.Opcode
	
	if payloadLen <= 125 {
		buf[1] = byte(payloadLen)
	} else if payloadLen <= 65535 {
		buf[1] = 126
		binary.BigEndian.PutUint16(buf[2:], uint16(payloadLen))
	} else {
		buf[1] = 127
		binary.BigEndian.PutUint64(buf[2:], uint64(payloadLen))
	}
	
	return append(buf, frame.Payload...), nil
}

func DecodeWebSocketFrame(reader io.Reader) (*WebSocketFrame, error) {
	header := make([]byte, 2)
	_, err := io.ReadFull(reader, header)
	if err != nil {
		return nil, err
	}
	
	opcode := header[0] & 0x0F
	masked := (header[1] & 0x80) != 0
	payloadLen := uint64(header[1] & 0x7F)
	
	switch payloadLen {
	case 126:
		lenBuf := make([]byte, 2)
		_, err = io.ReadFull(reader, lenBuf)
		if err != nil {
			return nil, err
		}
		payloadLen = uint64(binary.BigEndian.Uint16(lenBuf))
	case 127:
		lenBuf := make([]byte, 8)
		_, err = io.ReadFull(reader, lenBuf)
		if err != nil {
			return nil, err
		}
		payloadLen = binary.BigEndian.Uint64(lenBuf)
	}
	
	var maskKey []byte
	if masked {
		maskKey = make([]byte, 4)
		_, err = io.ReadFull(reader, maskKey)
		if err != nil {
			return nil, err
		}
	}
	
	payload := make([]byte, payloadLen)
	_, err = io.ReadFull(reader, payload)
	if err != nil {
		return nil, err
	}
	
	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}
	
	return &WebSocketFrame{
		Opcode:  opcode,
		Payload: payload,
	}, nil
}
