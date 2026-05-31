package rpc

import (
	"bytes"
	"fmt"
	"io"

	"github.com/nfs-proxy/internal/xdr"
)

const (
	MsgTypeCall  = 0
	MsgTypeReply = 1

	ReplyStatusMsgAccepted = 0
	ReplyStatusMsgDenied   = 1

	AcceptStatusSuccess      = 0
	AcceptStatusProgUnavail  = 1
	AcceptStatusProgMismatch = 2
	AcceptStatusProcUnavail  = 3
	AcceptStatusGarbageArgs  = 4
	AcceptStatusSystemErr    = 5

	RejectStatusRpcMismatch = 0
	RejectStatusAuthError   = 1

	AuthFlavorNone  = 0
	AuthFlavorUnix  = 1
	AuthFlavorShort = 2
	AuthFlavorDH    = 3
	AuthFlavorRPCSecGSS = 6

	RPCVersion = 2
)

type RPCMsg struct {
	Xid     uint32
	MsgType uint32
	Body    interface{}
}

type RPCMsgCall struct {
	RPCVersion uint32
	Program    uint32
	Version    uint32
	Procedure  uint32
	Cred       xdr.OpaqueAuth
	Verf       xdr.OpaqueAuth
	Body       []byte
}

type RPCMsgReply struct {
	ReplyStatus uint32
	Body        interface{}
}

type AcceptedReply struct {
	Verf         xdr.OpaqueAuth
	AcceptStatus uint32
	Data         []byte
}

type RejectedReply struct {
	RejectStatus uint32
	Data         interface{}
}

type RPCMismatchInfo struct {
	Low  uint32
	High uint32
}

type AuthError struct {
	Stat uint32
}

func (m *RPCMsg) DecodeXDR(r *xdr.Reader) error {
	var err error
	if m.Xid, err = r.ReadUint32(); err != nil {
		return err
	}
	if m.MsgType, err = r.ReadUint32(); err != nil {
		return err
	}

	switch m.MsgType {
	case MsgTypeCall:
		call := &RPCMsgCall{}
		if err := call.DecodeXDR(r); err != nil {
			return err
		}
		m.Body = call
	case MsgTypeReply:
		reply := &RPCMsgReply{}
		if err := reply.DecodeXDR(r); err != nil {
			return err
		}
		m.Body = reply
	default:
		return fmt.Errorf("unknown RPC message type: %d", m.MsgType)
	}
	return nil
}

func (m *RPCMsg) EncodeXDR(w *xdr.Writer) error {
	if err := w.WriteUint32(m.Xid); err != nil {
		return err
	}
	if err := w.WriteUint32(m.MsgType); err != nil {
		return err
	}

	switch body := m.Body.(type) {
	case *RPCMsgCall:
		return body.EncodeXDR(w)
	case *RPCMsgReply:
		return body.EncodeXDR(w)
	default:
		return fmt.Errorf("unknown RPC message body type")
	}
}

func (c *RPCMsgCall) DecodeXDR(r *xdr.Reader) error {
	var err error
	if c.RPCVersion, err = r.ReadUint32(); err != nil {
		return err
	}
	if c.RPCVersion != RPCVersion {
		return fmt.Errorf("unsupported RPC version: %d", c.RPCVersion)
	}
	if c.Program, err = r.ReadUint32(); err != nil {
		return err
	}
	if c.Version, err = r.ReadUint32(); err != nil {
		return err
	}
	if c.Procedure, err = r.ReadUint32(); err != nil {
		return err
	}
	if err := c.Cred.DecodeXDR(r); err != nil {
		return err
	}
	if err := c.Verf.DecodeXDR(r); err != nil {
		return err
	}

	var data []byte
	buf := make([]byte, 1024*1024)
	n, err := r.r.Read(buf)
	if err != nil && err != io.EOF {
		return err
	}
	c.Body = buf[:n]
	return nil
}

func (c *RPCMsgCall) EncodeXDR(w *xdr.Writer) error {
	if err := w.WriteUint32(c.RPCVersion); err != nil {
		return err
	}
	if err := w.WriteUint32(c.Program); err != nil {
		return err
	}
	if err := w.WriteUint32(c.Version); err != nil {
		return err
	}
	if err := w.WriteUint32(c.Procedure); err != nil {
		return err
	}
	if err := c.Cred.EncodeXDR(w); err != nil {
		return err
	}
	if err := c.Verf.EncodeXDR(w); err != nil {
		return err
	}
	_, err := w.w.Write(c.Body)
	return err
}

func (r *RPCMsgReply) DecodeXDR(rd *xdr.Reader) error {
	var err error
	if r.ReplyStatus, err = rd.ReadUint32(); err != nil {
		return err
	}

	switch r.ReplyStatus {
	case ReplyStatusMsgAccepted:
		ar := &AcceptedReply{}
		if err := ar.DecodeXDR(rd); err != nil {
			return err
		}
		r.Body = ar
	case ReplyStatusMsgDenied:
		rr := &RejectedReply{}
		if err := rr.DecodeXDR(rd); err != nil {
			return err
		}
		r.Body = rr
	default:
		return fmt.Errorf("unknown reply status: %d", r.ReplyStatus)
	}
	return nil
}

func (r *RPCMsgReply) EncodeXDR(w *xdr.Writer) error {
	if err := w.WriteUint32(r.ReplyStatus); err != nil {
		return err
	}

	switch body := r.Body.(type) {
	case *AcceptedReply:
		return body.EncodeXDR(w)
	case *RejectedReply:
		return body.EncodeXDR(w)
	default:
		return fmt.Errorf("unknown reply body type")
	}
}

func (a *AcceptedReply) DecodeXDR(r *xdr.Reader) error {
	var err error
	if err := a.Verf.DecodeXDR(r); err != nil {
		return err
	}
	if a.AcceptStatus, err = r.ReadUint32(); err != nil {
		return err
	}

	var data []byte
	buf := make([]byte, 1024*1024)
	n, err := r.r.Read(buf)
	if err != nil && err != io.EOF {
		return err
	}
	a.Data = buf[:n]
	return nil
}

func (a *AcceptedReply) EncodeXDR(w *xdr.Writer) error {
	if err := a.Verf.EncodeXDR(w); err != nil {
		return err
	}
	if err := w.WriteUint32(a.AcceptStatus); err != nil {
		return err
	}
	_, err := w.w.Write(a.Data)
	return err
}

func (r *RejectedReply) DecodeXDR(rd *xdr.Reader) error {
	var err error
	if r.RejectStatus, err = rd.ReadUint32(); err != nil {
		return err
	}

	switch r.RejectStatus {
	case RejectStatusRpcMismatch:
		mi := &RPCMismatchInfo{}
		if err := mi.DecodeXDR(rd); err != nil {
			return err
		}
		r.Data = mi
	case RejectStatusAuthError:
		ae := &AuthError{}
		if err := ae.DecodeXDR(rd); err != nil {
			return err
		}
		r.Data = ae
	default:
		return fmt.Errorf("unknown reject status: %d", r.RejectStatus)
	}
	return nil
}

func (r *RejectedReply) EncodeXDR(w *xdr.Writer) error {
	if err := w.WriteUint32(r.RejectStatus); err != nil {
		return err
	}

	switch data := r.Data.(type) {
	case *RPCMismatchInfo:
		return data.EncodeXDR(w)
	case *AuthError:
		return data.EncodeXDR(w)
	default:
		return fmt.Errorf("unknown rejected reply data type")
	}
}

func (m *RPCMismatchInfo) DecodeXDR(r *xdr.Reader) error {
	var err error
	if m.Low, err = r.ReadUint32(); err != nil {
		return err
	}
	if m.High, err = r.ReadUint32(); err != nil {
		return err
	}
	return nil
}

func (m *RPCMismatchInfo) EncodeXDR(w *xdr.Writer) error {
	if err := w.WriteUint32(m.Low); err != nil {
		return err
	}
	if err := w.WriteUint32(m.High); err != nil {
		return err
	}
	return nil
}

func (e *AuthError) DecodeXDR(r *xdr.Reader) error {
	var err error
	e.Stat, err = r.ReadUint32()
	return err
}

func (e *AuthError) EncodeXDR(w *xdr.Writer) error {
	return w.WriteUint32(e.Stat)
}

func (c *RPCMsgCall) String() string {
	return fmt.Sprintf("CALL{Xid: %d, Prog: %d, Vers: %d, Proc: %d, BodyLen: %d}",
		c.RPCVersion, c.Program, c.Version, c.Procedure, len(c.Body))
}

func (r *RPCMsgReply) String() string {
	switch body := r.Body.(type) {
	case *AcceptedReply:
		return fmt.Sprintf("REPLY{Status: ACCEPTED, AcceptStatus: %d, DataLen: %d}",
			body.AcceptStatus, len(body.Data))
	case *RejectedReply:
		return fmt.Sprintf("REPLY{Status: DENIED, RejectStatus: %d}", r.ReplyStatus)
	default:
		return "REPLY{Unknown}"
	}
}

func ReadRPCMessage(r io.Reader) (*RPCMsg, error) {
	msg := &RPCMsg{}
	xr := xdr.NewReader(r)
	if err := msg.DecodeXDR(xr); err != nil {
		return nil, err
	}
	return msg, nil
}

func WriteRPCMessage(w io.Writer, msg *RPCMsg) error {
	xw := xdr.NewWriter(w)
	return msg.EncodeXDR(xw)
}

func WriteRPCMessageToBytes(msg *RPCMsg) ([]byte, error) {
	var buf bytes.Buffer
	if err := WriteRPCMessage(&buf, msg); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func ReadRPCMessageFromBytes(data []byte) (*RPCMsg, error) {
	return ReadRPCMessage(bytes.NewReader(data))
}
