package mock

import (
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	"github.com/nfs-proxy/internal/nfs"
	"github.com/nfs-proxy/internal/rpc"
	"github.com/nfs-proxy/internal/xdr"
)

type MockServer struct {
	listener    net.Listener
	handlers    map[uint32]map[uint32]map[uint32]HandlerFunc
	mu          sync.RWMutex
	active      bool
	delay       time.Duration
	errorRate   float64
	stats       *MockStats
	requestChan chan *rpc.RPCMsg
}

type HandlerFunc func(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error)

type MockStats struct {
	mu               sync.Mutex
	RequestsReceived uint64
	ResponsesSent    uint64
	Errors           uint64
	ProcedureCounts  map[string]uint64
}

type MockConfig struct {
	ListenAddr string
	Delay      time.Duration
	ErrorRate  float64
}

func NewMockServer(cfg MockConfig) *MockServer {
	ms := &MockServer{
		handlers:   make(map[uint32]map[uint32]map[uint32]HandlerFunc),
		delay:      cfg.Delay,
		errorRate:  cfg.ErrorRate,
		stats: &MockStats{
			ProcedureCounts: make(map[string]uint64),
		},
	}
	ms.registerDefaultHandlers()
	return ms
}

func (ms *MockServer) registerDefaultHandlers() {
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureNull, ms.handleNull)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureGetAttr, ms.handleGetAttr)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureSetAttr, ms.handleSetAttr)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureLookup, ms.handleLookup)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureAccess, ms.handleAccess)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureRead, ms.handleRead)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureWrite, ms.handleWrite)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureCreate, ms.handleCreate)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureRemove, ms.handleRemove)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureReaddir, ms.handleReaddir)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureFsStat, ms.handleFsStat)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version3, nfs.NFS3ProcedureFsInfo, ms.handleFsInfo)

	ms.RegisterHandler(nfs.ProgramMount, 3, nfs.MountProcedureNull, ms.handleNull)
	ms.RegisterHandler(nfs.ProgramMount, 3, nfs.MountProcedureMNT, ms.handleMountMNT)
	ms.RegisterHandler(nfs.ProgramMount, 3, nfs.MountProcedureUMNT, ms.handleMountUMNT)
	ms.RegisterHandler(nfs.ProgramMount, 3, nfs.MountProcedureExport, ms.handleMountExport)

	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version4, nfs.NFS4ProcedureNull, ms.handleNull)
	ms.RegisterHandler(nfs.ProgramNFS, nfs.Version4, nfs.NFS4ProcedureCompound, ms.handleCompound)
}

func (ms *MockServer) RegisterHandler(program, version, proc uint32, handler HandlerFunc) {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	if _, ok := ms.handlers[program]; !ok {
		ms.handlers[program] = make(map[uint32]map[uint32]HandlerFunc)
	}
	if _, ok := ms.handlers[program][version]; !ok {
		ms.handlers[program][version] = make(map[uint32]HandlerFunc)
	}
	ms.handlers[program][version][proc] = handler
}

func (ms *MockServer) Serve() error {
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		return fmt.Errorf("failed to create listener: %w", err)
	}
	ms.listener = listener
	ms.active = true

	fmt.Printf("Mock NFS server listening on %s\n", listener.Addr())

	go ms.acceptConnections()
	return nil
}

func (ms *MockServer) acceptConnections() {
	for ms.active {
		conn, err := ms.listener.Accept()
		if err != nil {
			if ms.active {
				fmt.Printf("Mock server accept error: %v\n", err)
			}
			continue
		}
		go ms.handleConnection(conn)
	}
}

func (ms *MockServer) handleConnection(conn net.Conn) {
	defer conn.Close()

	buf := make([]byte, 1024*1024)

	for ms.active {
		conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		n, err := conn.Read(buf)
		if err != nil {
			if err != io.EOF {
				fmt.Printf("Mock server read error: %v\n", err)
			}
			return
		}

		msg, err := rpc.ReadRPCMessageFromBytes(buf[:n])
		if err != nil {
			fmt.Printf("Mock server parse error: %v\n", err)
			continue
		}

		ms.stats.mu.Lock()
		ms.stats.RequestsReceived++
		if call, ok := msg.Body.(*rpc.RPCMsgCall); ok {
			procName := nfs.ProcedureName(call.Program, call.Version, call.Procedure)
			ms.stats.ProcedureCounts[procName]++
		}
		ms.stats.mu.Unlock()

		resp := ms.processMessage(msg)
		if resp != nil {
			respData, err := rpc.WriteRPCMessageToBytes(resp)
			if err != nil {
				fmt.Printf("Mock server serialize error: %v\n", err)
				continue
			}

			if ms.delay > 0 {
				time.Sleep(ms.delay)
			}

			conn.Write(respData)
			ms.stats.mu.Lock()
			ms.stats.ResponsesSent++
			ms.stats.mu.Unlock()
		}
	}
}

func (ms *MockServer) processMessage(msg *rpc.RPCMsg) *rpc.RPCMsg {
	resp := &rpc.RPCMsg{
		Xid:     msg.Xid,
		MsgType: rpc.MsgTypeReply,
	}

	call, ok := msg.Body.(*rpc.RPCMsgCall)
	if !ok {
		resp.Body = &rpc.RPCMsgReply{
			ReplyStatus: rpc.ReplyStatusMsgDenied,
			Body: &rpc.RejectedReply{
				RejectStatus: rpc.RejectStatusAuthError,
				Data:         &rpc.AuthError{Stat: 1},
			},
		}
		return resp
	}

	ms.mu.RLock()
	progHandlers, ok := ms.handlers[call.Program]
	if !ok {
		ms.mu.RUnlock()
		resp.Body = ms.makeAcceptedReply(call, rpc.AcceptStatusProgUnavail, nil)
		return resp
	}

	verHandlers, ok := progHandlers[call.Version]
	if !ok {
		ms.mu.RUnlock()
		resp.Body = ms.makeAcceptedReply(call, rpc.AcceptStatusProgMismatch, nil)
		return resp
	}

	handler, ok := verHandlers[call.Procedure]
	if !ok {
		ms.mu.RUnlock()
		resp.Body = ms.makeAcceptedReply(call, rpc.AcceptStatusProcUnavail, nil)
		return resp
	}
	ms.mu.RUnlock()

	reply, err := handler(call)
	if err != nil {
		ms.stats.mu.Lock()
		ms.stats.Errors++
		ms.stats.mu.Unlock()
		resp.Body = ms.makeAcceptedReply(call, rpc.AcceptStatusSystemErr, nil)
		return resp
	}

	resp.Body = reply
	return resp
}

func (ms *MockServer) makeAcceptedReply(call *rpc.RPCMsgCall, status uint32, data []byte) *rpc.RPCMsgReply {
	return &rpc.RPCMsgReply{
		ReplyStatus: rpc.ReplyStatusMsgAccepted,
		Body: &rpc.AcceptedReply{
			Verf: xdr.OpaqueAuth{
				Flavor: 0,
				Body:   []byte{},
			},
			AcceptStatus: status,
			Data:         data,
		},
	}
}

func (ms *MockServer) handleNull(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, []byte{}), nil
}

func (ms *MockServer) handleGetAttr(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 256)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleSetAttr(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 256)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleLookup(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 512)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleAccess(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 64)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	binary.BigEndian.PutUint32(respData[4:8], 0x1F)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleRead(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	if len(req.Body) >= 32 {
		count := binary.BigEndian.Uint32(req.Body[24:28])
		respData := make([]byte, 12+int(count))
		binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
		binary.BigEndian.PutUint32(respData[8:12], count)
		copy(respData[12:], make([]byte, count))
		return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
	}
	respData := make([]byte, 128)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleWrite(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 128)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleCreate(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 512)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleRemove(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 64)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleReaddir(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 1024)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	binary.BigEndian.PutUint32(respData[8:12], 1)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleFsStat(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 128)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	binary.BigEndian.PutUint64(respData[4:12], 1024*1024*1024)
	binary.BigEndian.PutUint64(respData[12:20], 512*1024*1024)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleFsInfo(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 128)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	binary.BigEndian.PutUint32(respData[4:8], 0x7FFF)
	binary.BigEndian.PutUint32(respData[8:12], 8192)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleMountMNT(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 256)
	binary.BigEndian.PutUint32(respData[0:4], 0)
	fh := []byte("mock_file_handle_12345")
	binary.BigEndian.PutUint32(respData[4:8], uint32(len(fh)))
	copy(respData[8:8+len(fh)], fh)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleMountUMNT(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, []byte{}), nil
}

func (ms *MockServer) handleMountExport(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 256)
	binary.BigEndian.PutUint32(respData[0:4], 0)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) handleCompound(req *rpc.RPCMsgCall) (*rpc.RPCMsgReply, error) {
	respData := make([]byte, 512)
	binary.BigEndian.PutUint32(respData[0:4], nfs.NFS3_OK)
	return ms.makeAcceptedReply(req, rpc.AcceptStatusSuccess, respData), nil
}

func (ms *MockServer) Shutdown() error {
	ms.active = false
	if ms.listener != nil {
		return ms.listener.Close()
	}
	return nil
}

func (ms *MockServer) Addr() net.Addr {
	if ms.listener != nil {
		return ms.listener.Addr()
	}
	return nil
}

func (ms *MockServer) SetDelay(delay time.Duration) {
	ms.delay = delay
}

func (ms *MockServer) SetErrorRate(rate float64) {
	ms.errorRate = rate
}

func (ms *MockServer) GetStats() *MockStats {
	ms.stats.mu.Lock()
	defer ms.stats.mu.Unlock()

	stats := &MockStats{
		RequestsReceived: ms.stats.RequestsReceived,
		ResponsesSent:    ms.stats.ResponsesSent,
		Errors:           ms.stats.Errors,
		ProcedureCounts:  make(map[string]uint64),
	}
	for k, v := range ms.stats.ProcedureCounts {
		stats.ProcedureCounts[k] = v
	}
	return stats
}

func (ms *MockStats) Print() {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	fmt.Println("=== Mock NFS Server Statistics ===")
	fmt.Printf("Requests Received: %d\n", ms.RequestsReceived)
	fmt.Printf("Responses Sent:    %d\n", ms.ResponsesSent)
	fmt.Printf("Errors:            %d\n", ms.Errors)
	fmt.Println("\nProcedure Counts:")
	for proc, count := range ms.ProcedureCounts {
		fmt.Printf("  %-20s: %d\n", proc, count)
	}
	fmt.Println("==================================")
}
