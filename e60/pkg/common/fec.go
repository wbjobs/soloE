package common

import (
	"crypto/rand"
	"encoding/binary"
	"hash/crc32"
	"sync"
)

const (
	FECDataPackets   = 4    
	FECRepairPackets = 2    
	FECMaxPackets    = FECDataPackets + FECRepairPackets
	FECPacketSize    = 1400 
)

type FECPacketType byte

const (
	FECPacketData   FECPacketType = 0
	FECPacketRepair FECPacketType = 1
)

type FECHeader struct {
	Type       FECPacketType
	BlockID    uint32
	PacketNum  uint8
	TotalData  uint8
	Length     uint16
	Checksum   uint32
}

type FECBlock struct {
	BlockID    uint32
	DataPackets [][]byte
	RepairPackets [][]byte
	Received    map[uint8]bool
	Complete    bool
}

type FECEncoder struct {
	mu         sync.Mutex
	blockID    uint32
	currentBlock *FECBlock
	packetBuf  []byte
}

func NewFECEncoder() *FECEncoder {
	return &FECEncoder{
		packetBuf: make([]byte, 0, FECDataPackets),
	}
}

func (e *FECEncoder) Encode(data []byte) ([][]byte, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	var packets [][]byte

	chunks := splitData(data, FECPacketSize-12) 

	for _, chunk := range chunks {
		if e.currentBlock == nil {
			e.currentBlock = &FECBlock{
				BlockID:    e.blockID,
				DataPackets: make([][]byte, FECDataPackets),
				Received:   make(map[uint8]bool),
			}
			e.blockID++
		}

		packetNum := len(e.packetBuf)
		e.currentBlock.DataPackets[packetNum] = chunk
		e.packetBuf = append(e.packetBuf, 0)

		if len(e.packetBuf) >= FECDataPackets {
			blockPackets := e.generateBlock(e.currentBlock)
			packets = append(packets, blockPackets...)
			e.currentBlock = nil
			e.packetBuf = e.packetBuf[:0]
		}
	}

	if e.currentBlock != nil && len(e.packetBuf) > 0 {
		blockPackets := e.generateBlock(e.currentBlock)
		packets = append(packets, blockPackets...)
		e.currentBlock = nil
		e.packetBuf = e.packetBuf[:0]
	}

	return packets, nil
}

func (e *FECEncoder) generateBlock(block *FECBlock) [][]byte {
	numData := len(e.packetBuf)
	for i := numData; i < FECDataPackets; i++ {
		block.DataPackets[i] = []byte{}
	}

	block.RepairPackets = make([][]byte, FECRepairPackets)
	for i := range block.RepairPackets {
		block.RepairPackets[i] = make([]byte, FECPacketSize-12)
	}

	for col := 0; col < FECPacketSize-12; col++ {
		var xor1, xor2 byte
		for row := 0; row < numData; row++ {
			if col < len(block.DataPackets[row]) {
				xor1 ^= block.DataPackets[row][col]
				xor2 ^= block.DataPackets[row][col] * byte(row+1)
			}
		}
		block.RepairPackets[0][col] = xor1
		block.RepairPackets[1][col] = xor2
	}

	var packets [][]byte

	for i := 0; i < numData; i++ {
		packet := e.makePacket(FECPacketData, block.BlockID, uint8(i), uint8(numData), block.DataPackets[i])
		packets = append(packets, packet)
	}

	for i := 0; i < FECRepairPackets; i++ {
		packet := e.makePacket(FECPacketRepair, block.BlockID, uint8(i), uint8(numData), block.RepairPackets[i])
		packets = append(packets, packet)
	}

	return packets
}

func (e *FECEncoder) makePacket(typ FECPacketType, blockID uint32, packetNum uint8, totalData uint8, data []byte) []byte {
	packet := make([]byte, 12+len(data))

	packet[0] = byte(typ)
	binary.BigEndian.PutUint32(packet[1:5], blockID)
	packet[5] = packetNum
	packet[6] = totalData
	binary.BigEndian.PutUint16(packet[7:9], uint16(len(data)))

	copy(packet[12:], data)

	checksum := crc32.ChecksumIEEE(packet[:9])
	binary.BigEndian.PutUint32(packet[9:13], checksum)

	return packet
}

type FECDecoder struct {
	mu       sync.Mutex
	blocks   map[uint32]*FECBlock
	maxBlocks int
}

func NewFECDecoder() *FECDecoder {
	return &FECDecoder{
		blocks:    make(map[uint32]*FECBlock),
		maxBlocks: 100,
	}
}

func (d *FECDecoder) Decode(packet []byte) ([][]byte, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if len(packet) < 12 {
		return nil, false
	}

	header := FECHeader{
		Type:      FECPacketType(packet[0]),
		BlockID:   binary.BigEndian.Uint32(packet[1:5]),
		PacketNum: packet[5],
		TotalData: packet[6],
		Length:    binary.BigEndian.Uint16(packet[7:9]),
		Checksum:  binary.BigEndian.Uint32(packet[9:13]),
	}

	checksum := crc32.ChecksumIEEE(packet[:9])
	if checksum != header.Checksum {
		return nil, false
	}

	block, exists := d.blocks[header.BlockID]
	if !exists {
		if len(d.blocks) >= d.maxBlocks {
			var oldestID uint32
			for id := range d.blocks {
				oldestID = id
				break
			}
			delete(d.blocks, oldestID)
		}

		block = &FECBlock{
			BlockID:     header.BlockID,
			DataPackets: make([][]byte, FECDataPackets),
			RepairPackets: make([][]byte, FECRepairPackets),
			Received:    make(map[uint8]bool),
		}
		d.blocks[header.BlockID] = block
	}

	data := packet[12:]
	if header.Type == FECPacketData {
		block.DataPackets[header.PacketNum] = data
	} else {
		block.RepairPackets[header.PacketNum] = data
	}
	block.Received[header.PacketNum] = true

	receivedData := 0
	for i := 0; i < int(header.TotalData); i++ {
		if block.Received[uint8(i)] {
			receivedData++
		}
	}

	if receivedData == int(header.TotalData) {
		var result [][]byte
		for i := 0; i < int(header.TotalData); i++ {
			if len(block.DataPackets[i]) > 0 {
				result = append(result, block.DataPackets[i])
			}
		}
		delete(d.blocks, header.BlockID)
		return result, true
	}

	receivedRepair := 0
	for i := 0; i < FECRepairPackets; i++ {
		if block.RepairPackets[i] != nil {
			receivedRepair++
		}
	}

	if receivedData+receivedRepair >= int(header.TotalData) {
		return d.recoverBlock(block, int(header.TotalData))
	}

	return nil, false
}

func (d *FECDecoder) recoverBlock(block *FECBlock, numData int) ([][]byte, bool) {
	lost := -1
	for i := 0; i < numData; i++ {
		if !block.Received[uint8(i)] {
			if lost == -1 {
				lost = i
			} else {
				return nil, false
			}
		}
	}

	if lost == -1 {
		var result [][]byte
		for i := 0; i < numData; i++ {
			if len(block.DataPackets[i]) > 0 {
				result = append(result, block.DataPackets[i])
			}
		}
		return result, true
	}

	if block.RepairPackets[0] == nil {
		return nil, false
	}

	maxLen := len(block.RepairPackets[0])
	recovered := make([]byte, maxLen)
	for col := 0; col < maxLen; col++ {
		var xor byte
		for row := 0; row < numData; row++ {
			if row != lost && col < len(block.DataPackets[row]) {
				xor ^= block.DataPackets[row][col]
			}
		}
		recovered[col] = xor ^ block.RepairPackets[0][col]
	}

	block.DataPackets[lost] = recovered

	var result [][]byte
	for i := 0; i < numData; i++ {
		if len(block.DataPackets[i]) > 0 {
			result = append(result, block.DataPackets[i])
		}
	}

	return result, true
}

func splitData(data []byte, chunkSize int) [][]byte {
	var chunks [][]byte
	for i := 0; i < len(data); i += chunkSize {
		end := i + chunkSize
		if end > len(data) {
			end = len(data)
		}
		chunks = append(chunks, data[i:end])
	}
	return chunks
}

func GenerateRandomData(size int) []byte {
	data := make([]byte, size)
	rand.Read(data)
	return data
}
