package common

import (
	"math"
	"sync"
	"time"
)

const (
	BBRBeta         = 0.7   
	BBRGain         = 2.0   
	BBRWindowLength = 10    
	RTTAlpha        = 0.125 
)

type BBRState int

const (
	BBRStartup BBRState = iota
	BBRDrain
	BBRProbeBW
	BBRProbeRTT
)

type BBR struct {
	mu sync.Mutex

	state BBRState

	bandwidth float64 
	minRTT    time.Duration

	cwnd          int
	pacingRate    float64
	nextSendTime  time.Time

	roundTripCount int
	rtPropStamp    time.Time

	packetCount   int
	delivered     int
	lost          int
	bytesInFlight int

	maxBandwidthWindow [BBRWindowLength]float64
	minRTTWindow      [BBRWindowLength]time.Duration
	windowIndex        int

	startupRoundCount  int
	fullBandwidthCount int
	lastMaxBandwidth   float64

	probeRTTStartTime time.Time
	probeBWPhase      int
}

func NewBBR() *BBR {
	return &BBR{
		state:         BBRStartup,
		cwnd:          10,
		pacingRate:    1e6, 
		rtPropStamp:   time.Now(),
		nextSendTime:  time.Now(),
	}
}

func (b *BBR) OnPacketSent(bytes int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.bytesInFlight += bytes
	b.packetCount++
}

func (b *BBR) OnPacketAcked(bytes int, rtt time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.bytesInFlight -= bytes
	b.delivered += bytes

	b.updateBandwidth(bytes, rtt)
	b.updateMinRTT(rtt)
	b.updateState()
	b.updateCongestionWindow()
	b.updatePacingRate()
}

func (b *BBR) OnPacketLost(bytes int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.bytesInFlight -= bytes
	b.lost += bytes

	if b.state == BBRStartup {
		b.cwnd = int(float64(b.cwnd) * BBRBeta)
		if b.cwnd < 2 {
			b.cwnd = 2
		}
	}
}

func (b *BBR) updateBandwidth(bytes int, rtt time.Duration) {
	if rtt <= 0 {
		return
	}

	rate := float64(bytes*8) / rtt.Seconds() 
	b.maxBandwidthWindow[b.windowIndex] = math.Max(b.maxBandwidthWindow[b.windowIndex], rate)
}

func (b *BBR) updateMinRTT(rtt time.Duration) {
	if rtt <= 0 {
		return
	}

	if b.minRTT == 0 || rtt < b.minRTT {
		b.minRTT = rtt
		b.rtPropStamp = time.Now()
	}

	b.minRTTWindow[b.windowIndex] = rtt
}

func (b *BBR) updateState() {
	b.roundTripCount++
	if b.roundTripCount%BBRWindowLength == 0 {
		b.windowIndex = (b.windowIndex + 1) % BBRWindowLength
		b.maxBandwidthWindow[b.windowIndex] = 0
	}

	b.bandwidth = b.getMaxBandwidth()

	switch b.state {
	case BBRStartup:
		b.handleStartup()
	case BBRDrain:
		b.handleDrain()
	case BBRProbeBW:
		b.handleProbeBW()
	case BBRProbeRTT:
		b.handleProbeRTT()
	}
}

func (b *BBR) handleStartup() {
	b.startupRoundCount++

	if b.bandwidth > b.lastMaxBandwidth*1.25 {
		b.fullBandwidthCount = 0
		b.lastMaxBandwidth = b.bandwidth
	} else {
		b.fullBandwidthCount++
	}

	if b.fullBandwidthCount >= 3 {
		b.state = BBRDrain
		b.rtPropStamp = time.Now()
	}
}

func (b *BBR) handleDrain() {
	targetCwnd := int(b.bandwidth * b.minRTT.Seconds() / 8 / 1500) 
	if b.cwnd <= targetCwnd || time.Since(b.rtPropStamp) > b.minRTT*3 {
		b.state = BBRProbeBW
		b.probeBWPhase = 0
	}
}

func (b *BBR) handleProbeBW() {
	if b.roundTripCount%8 == 0 {
		b.probeBWPhase = (b.probeBWPhase + 1) % 8
	}

	if time.Since(b.rtPropStamp) > 10*time.Second {
		b.state = BBRProbeRTT
		b.probeRTTStartTime = time.Now()
	}
}

func (b *BBR) handleProbeRTT() {
	if time.Since(b.probeRTTStartTime) > 200*time.Millisecond {
		b.state = BBRProbeBW
		b.rtPropStamp = time.Now()
		b.minRTT = 0
		for _, rtt := range b.minRTTWindow {
			if rtt > 0 && (b.minRTT == 0 || rtt < b.minRTT) {
				b.minRTT = rtt
			}
		}
	}
}

func (b *BBR) updateCongestionWindow() {
	if b.minRTT <= 0 {
		return
	}

	bdp := int((b.bandwidth * b.minRTT.Seconds()) / 8 / 1500) 

	switch b.state {
	case BBRStartup:
		targetCwnd := int(float64(bdp) * BBRGain)
		if b.cwnd < targetCwnd {
			b.cwnd += 1
		}
	case BBRDrain:
		if b.cwnd > bdp {
			b.cwnd = int(float64(b.cwnd) * BBRBeta)
		}
	case BBRProbeBW:
		gain := 1.0
		if b.probeBWPhase == 0 {
			gain = 1.25
		} else if b.probeBWPhase == 1 {
			gain = 0.75
		}
		b.cwnd = int(float64(bdp) * gain)
	case BBRProbeRTT:
		b.cwnd = 4
	}

	if b.cwnd < 2 {
		b.cwnd = 2
	}
}

func (b *BBR) updatePacingRate() {
	if b.minRTT <= 0 {
		return
	}

	gain := 1.0
	switch b.state {
	case BBRStartup:
		gain = BBRGain
	case BBRDrain:
		gain = BBRBeta
	case BBRProbeBW:
		if b.probeBWPhase == 0 {
			gain = 1.25
		} else if b.probeBWPhase == 1 {
			gain = 0.75
		}
	case BBRProbeRTT:
		gain = 0.5
	}

	b.pacingRate = b.bandwidth * gain
}

func (b *BBR) getMaxBandwidth() float64 {
	maxBW := 0.0
	for _, bw := range b.maxBandwidthWindow {
		if bw > maxBW {
			maxBW = bw
		}
	}
	return maxBW
}

func (b *BBR) GetCongestionWindow() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.cwnd
}

func (b *BBR) GetPacingRate() float64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.pacingRate
}

func (b *BBR) CanSend(bytes int) bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	now := time.Now()
	if now.Before(b.nextSendTime) {
		return false
	}

	maxInFlight := b.cwnd * 1500 
	return b.bytesInFlight+bytes <= maxInFlight
}

func (b *BBR) UpdateSendTime(bytes int) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.pacingRate > 0 {
		delay := time.Duration(float64(bytes*8)/b.pacingRate) * time.Second
		b.nextSendTime = time.Now().Add(delay)
	}
}

func (b *BBR) GetState() BBRState {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.state
}

func (b *BBR) GetStats() (bandwidth float64, minRTT time.Duration, cwnd int, lost int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.bandwidth, b.minRTT, b.cwnd, b.lost
}
