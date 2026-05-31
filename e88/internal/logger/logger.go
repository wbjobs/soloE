package logger

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/nfs-proxy/internal/nfs"
	"github.com/nfs-proxy/internal/rpc"
)

const (
	FrameMagic     uint32 = 0x4E465350
	FrameVersion   uint16 = 1
	MaxFrameSize   uint32 = 10 * 1024 * 1024
)

type LogEntry struct {
	Timestamp   time.Time `json:"timestamp"`
	Direction   string    `json:"direction"`
	Xid         uint32    `json:"xid"`
	Program     uint32    `json:"program"`
	Version     uint32    `json:"version"`
	Procedure   uint32    `json:"procedure"`
	ProcName    string    `json:"proc_name"`
	RawData     []byte    `json:"raw_data"`
	PayloadSize int       `json:"payload_size"`
	Error       string    `json:"error,omitempty"`
}

type RequestLogger struct {
	mu       sync.Mutex
	logFile  *os.File
	enc      *json.Encoder
	rawFile  *os.File
	binFile  *os.File
	filename string
}

type Config struct {
	LogDir       string
	Filename     string
	EnableJSON   bool
	EnableRaw    bool
	EnableBinary bool
}

type FrameHeader struct {
	Magic     uint32
	Version   uint16
	Flags     uint16
	Timestamp uint64
	Checksum  uint32
	DataLen   uint32
	MetaLen   uint32
}

type FixResult struct {
	TotalEntries    int
	ValidEntries    int
	CorruptedEntries int
	RecoveredEntries int
	OutputFile      string
}

func NewRequestLogger(cfg Config) (*RequestLogger, error) {
	if cfg.LogDir == "" {
		cfg.LogDir = "./logs"
	}
	if cfg.Filename == "" {
		cfg.Filename = fmt.Sprintf("nfs_proxy_%s", time.Now().Format("20060102_150405"))
	}

	if err := os.MkdirAll(cfg.LogDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create log directory: %w", err)
	}

	rl := &RequestLogger{
		filename: filepath.Join(cfg.LogDir, cfg.Filename),
	}

	if cfg.EnableJSON {
		jsonFile, err := os.Create(rl.filename + ".json")
		if err != nil {
			rl.Close()
			return nil, fmt.Errorf("failed to create JSON log file: %w", err)
		}
		rl.logFile = jsonFile
		rl.enc = json.NewEncoder(jsonFile)
	}

	if cfg.EnableRaw {
		rawFile, err := os.Create(rl.filename + ".raw")
		if err != nil {
			rl.Close()
			return nil, fmt.Errorf("failed to create raw log file: %w", err)
		}
		rl.rawFile = rawFile
	}

	if cfg.EnableBinary {
		binFile, err := os.Create(rl.filename + ".bin")
		if err != nil {
			rl.Close()
			return nil, fmt.Errorf("failed to create binary log file: %w", err)
		}
		rl.binFile = binFile
	}

	return rl, nil
}

func (rl *RequestLogger) LogRequest(msg *rpc.RPCMsg, direction string) error {
	entry := LogEntry{
		Timestamp: time.Now(),
		Direction: direction,
		Xid:       msg.Xid,
	}

	rawData, err := rpc.WriteRPCMessageToBytes(msg)
	if err != nil {
		entry.Error = err.Error()
	}
	entry.RawData = rawData
	entry.PayloadSize = len(rawData)

	if call, ok := msg.Body.(*rpc.RPCMsgCall); ok {
		entry.Program = call.Program
		entry.Version = call.Version
		entry.Procedure = call.Procedure
		entry.ProcName = nfs.ProcedureName(call.Program, call.Version, call.Procedure)
	} else if reply, ok := msg.Body.(*rpc.RPCMsgReply); ok {
		if ar, ok := reply.Body.(*rpc.AcceptedReply); ok {
			entry.PayloadSize = len(ar.Data)
		}
	}

	if rl.enc != nil {
		rl.mu.Lock()
		err := rl.enc.Encode(entry)
		rl.mu.Unlock()
		if err != nil {
			return fmt.Errorf("failed to write JSON log: %w", err)
		}
	}

	if rl.rawFile != nil {
		rawLine := fmt.Sprintf("[%s] %s XID=%d Prog=%d Vers=%d Proc=%d (%s) Size=%d\n",
			entry.Timestamp.Format(time.RFC3339Nano),
			direction,
			entry.Xid,
			entry.Program,
			entry.Version,
			entry.Procedure,
			entry.ProcName,
			entry.PayloadSize)
		rl.mu.Lock()
		_, err := rl.rawFile.WriteString(rawLine)
		rl.mu.Unlock()
		if err != nil {
			return fmt.Errorf("failed to write raw log: %w", err)
		}
	}

	if rl.binFile != nil {
		frameData, err := encodeFrame(&entry)
		if err != nil {
			return fmt.Errorf("failed to encode frame: %w", err)
		}
		rl.mu.Lock()
		_, err = rl.binFile.Write(frameData)
		rl.mu.Unlock()
		if err != nil {
			return fmt.Errorf("failed to write binary log: %w", err)
		}
	}

	return nil
}

func encodeFrame(entry *LogEntry) ([]byte, error) {
	metaData, err := json.Marshal(struct {
		Timestamp int64  `json:"ts"`
		Direction string `json:"dir"`
		Xid       uint32 `json:"xid"`
		Program   uint32 `json:"prog"`
		Version   uint32 `json:"vers"`
		Procedure uint32 `json:"proc"`
	}{
		Timestamp: entry.Timestamp.UnixNano(),
		Direction: entry.Direction,
		Xid:       entry.Xid,
		Program:   entry.Program,
		Version:   entry.Version,
		Procedure: entry.Procedure,
	})
	if err != nil {
		return nil, err
	}

	dataLen := uint32(len(entry.RawData))
	metaLen := uint32(len(metaData))

	checksumData := make([]byte, 0, 8+dataLen+metaLen)
	checksumData = binary.LittleEndian.AppendUint32(checksumData, dataLen)
	checksumData = binary.LittleEndian.AppendUint32(checksumData, metaLen)
	checksumData = append(checksumData, entry.RawData...)
	checksumData = append(checksumData, metaData...)
	checksum := crc32.ChecksumIEEE(checksumData)

	header := FrameHeader{
		Magic:     FrameMagic,
		Version:   FrameVersion,
		Flags:     0,
		Timestamp: uint64(entry.Timestamp.UnixNano()),
		Checksum:  checksum,
		DataLen:   dataLen,
		MetaLen:   metaLen,
	}

	frame := make([]byte, 0, 24+dataLen+metaLen)
	frame = binary.LittleEndian.AppendUint32(frame, header.Magic)
	frame = binary.LittleEndian.AppendUint16(frame, header.Version)
	frame = binary.LittleEndian.AppendUint16(frame, header.Flags)
	frame = binary.LittleEndian.AppendUint64(frame, header.Timestamp)
	frame = binary.LittleEndian.AppendUint32(frame, header.Checksum)
	frame = binary.LittleEndian.AppendUint32(frame, header.DataLen)
	frame = binary.LittleEndian.AppendUint32(frame, header.MetaLen)
	frame = append(frame, entry.RawData...)
	frame = append(frame, metaData...)

	return frame, nil
}

func decodeFrame(data []byte) (*LogEntry, error) {
	if len(data) < 24 {
		return nil, fmt.Errorf("frame too short")
	}

	magic := binary.LittleEndian.Uint32(data[0:4])
	if magic != FrameMagic {
		return nil, fmt.Errorf("invalid magic number: 0x%x", magic)
	}

	version := binary.LittleEndian.Uint16(data[4:6])
	if version != FrameVersion {
		return nil, fmt.Errorf("unsupported frame version: %d", version)
	}

	timestamp := binary.LittleEndian.Uint64(data[8:16])
	checksum := binary.LittleEndian.Uint32(data[16:20])
	dataLen := binary.LittleEndian.Uint32(data[20:24])
	metaLen := binary.LittleEndian.Uint32(data[24:28])

	totalLen := 28 + int(dataLen) + int(metaLen)
	if len(data) < totalLen {
		return nil, fmt.Errorf("truncated frame: need %d, have %d", totalLen, len(data))
	}

	rawData := data[28 : 28+dataLen]
	metaData := data[28+dataLen : 28+dataLen+metaLen]

	checksumData := make([]byte, 0, 8+dataLen+metaLen)
	checksumData = binary.LittleEndian.AppendUint32(checksumData, dataLen)
	checksumData = binary.LittleEndian.AppendUint32(checksumData, metaLen)
	checksumData = append(checksumData, rawData...)
	checksumData = append(checksumData, metaData...)
	calcChecksum := crc32.ChecksumIEEE(checksumData)

	if calcChecksum != checksum {
		return nil, fmt.Errorf("checksum mismatch: expected 0x%x, got 0x%x", checksum, calcChecksum)
	}

	var meta struct {
		Direction string `json:"dir"`
		Xid       uint32 `json:"xid"`
		Program   uint32 `json:"prog"`
		Version   uint32 `json:"vers"`
		Procedure uint32 `json:"proc"`
	}
	if err := json.Unmarshal(metaData, &meta); err != nil {
		return nil, fmt.Errorf("failed to unmarshal meta: %w", err)
	}

	return &LogEntry{
		Timestamp:   time.Unix(0, int64(timestamp)),
		Direction:   meta.Direction,
		Xid:         meta.Xid,
		Program:     meta.Program,
		Version:     meta.Version,
		Procedure:   meta.Procedure,
		ProcName:    nfs.ProcedureName(meta.Program, meta.Version, meta.Procedure),
		RawData:     rawData,
		PayloadSize: len(rawData),
	}, nil
}

func ReadBinaryEntries(filename string) ([]*rpc.RPCMsg, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, fmt.Errorf("failed to open binary log file: %w", err)
	}
	defer f.Close()

	var messages []*rpc.RPCMsg
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	offset := 0
	for offset < len(data) {
		if offset+4 > len(data) {
			break
		}

		magic := binary.LittleEndian.Uint32(data[offset : offset+4])
		if magic != FrameMagic {
			offset++
			continue
		}

		if offset+28 > len(data) {
			break
		}

		dataLen := binary.LittleEndian.Uint32(data[offset+20 : offset+24])
		metaLen := binary.LittleEndian.Uint32(data[offset+24 : offset+28])
		frameLen := 28 + int(dataLen) + int(metaLen)

		if offset+frameLen > len(data) {
			break
		}

		entry, err := decodeFrame(data[offset : offset+frameLen])
		if err != nil {
			offset++
			continue
		}

		msg, err := rpc.ReadRPCMessageFromBytes(entry.RawData)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to parse RPC message at offset %d: %v\n", offset, err)
			offset += frameLen
			continue
		}

		messages = append(messages, msg)
		offset += frameLen
	}

	return messages, nil
}

func FixBinaryLog(inputFile, outputFile string) (*FixResult, error) {
	data, err := os.ReadFile(inputFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read input file: %w", err)
	}

	result := &FixResult{}
	var validFrames []byte

	offset := 0
	for offset < len(data) {
		result.TotalEntries++

		if offset+4 > len(data) {
			result.CorruptedEntries++
			break
		}

		magic := binary.LittleEndian.Uint32(data[offset : offset+4])
		if magic != FrameMagic {
			result.CorruptedEntries++
			offset = findNextMagic(data, offset+1)
			if offset == -1 {
				break
			}
			continue
		}

		if offset+28 > len(data) {
			result.CorruptedEntries++
			break
		}

		dataLen := binary.LittleEndian.Uint32(data[offset+20 : offset+24])
		metaLen := binary.LittleEndian.Uint32(data[offset+24 : offset+28])

		if dataLen > MaxFrameSize || metaLen > MaxFrameSize {
			result.CorruptedEntries++
			offset = findNextMagic(data, offset+1)
			if offset == -1 {
				break
			}
			continue
		}

		frameLen := 28 + int(dataLen) + int(metaLen)
		if offset+frameLen > len(data) {
			result.CorruptedEntries++
			offset = findNextMagic(data, offset+1)
			if offset == -1 {
				break
			}
			continue
		}

		entry, err := decodeFrame(data[offset : offset+frameLen])
		if err != nil {
			result.CorruptedEntries++
			offset = findNextMagic(data, offset+1)
			if offset == -1 {
				break
			}
			continue
		}

		_, err = rpc.ReadRPCMessageFromBytes(entry.RawData)
		if err != nil {
			result.CorruptedEntries++
			offset += frameLen
			continue
		}

		validFrames = append(validFrames, data[offset:offset+frameLen]...)
		result.ValidEntries++
		offset += frameLen
	}

	if len(validFrames) > 0 {
		if outputFile == "" {
			outputFile = inputFile + ".fixed"
		}
		if err := os.WriteFile(outputFile, validFrames, 0644); err != nil {
			return nil, fmt.Errorf("failed to write output file: %w", err)
		}
		result.OutputFile = outputFile
		result.RecoveredEntries = result.ValidEntries
	}

	return result, nil
}

func findNextMagic(data []byte, start int) int {
	for i := start; i <= len(data)-4; i++ {
		if binary.LittleEndian.Uint32(data[i:i+4]) == FrameMagic {
			return i
		}
	}
	return -1
}

func ReadJSONEntries(filename string) ([]*rpc.RPCMsg, error) {
	f, err := os.Open(filename)
	if err != nil {
		return nil, fmt.Errorf("failed to open JSON log file: %w", err)
	}
	defer f.Close()

	var messages []*rpc.RPCMsg
	dec := json.NewDecoder(f)

	for {
		var entry LogEntry
		if err := dec.Decode(&entry); err != nil {
			if err == io.EOF {
				break
			}
			_, ok := err.(*json.SyntaxError)
			if ok {
				fmt.Fprintf(os.Stderr, "Warning: skipping corrupted JSON entry\n")
				continue
			}
			return nil, fmt.Errorf("failed to decode JSON entry: %w", err)
		}

		if entry.Direction != "REQUEST" {
			continue
		}

		msg, err := rpc.ReadRPCMessageFromBytes(entry.RawData)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to parse RPC message: %v\n", err)
			continue
		}

		messages = append(messages, msg)
	}

	return messages, nil
}

func (rl *RequestLogger) Close() error {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	var errs []error
	if rl.logFile != nil {
		if err := rl.logFile.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if rl.rawFile != nil {
		if err := rl.rawFile.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if rl.binFile != nil {
		if err := rl.binFile.Close(); err != nil {
			errs = append(errs, err)
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors closing log files: %v", errs)
	}
	return nil
}

func (rl *RequestLogger) Filename() string {
	return rl.filename
}
