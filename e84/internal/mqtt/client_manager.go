package mqtt

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"mqtt-load-tester/internal/config"
	"mqtt-load-tester/internal/stats"
)

const (
	DefaultMaxConcurrentConnects = 50
	DefaultConnectDelay          = 100 * time.Millisecond
)

type MessagePayload struct {
	ID        uint64 `json:"id"`
	Timestamp int64  `json:"ts"`
	Data      []byte `json:"data,omitempty"`
}

type ClientManager struct {
	cfg                  *config.Config
	stats                *stats.Statistics
	failureStats         *stats.FailureInjectionStats
	clients              []mqtt.Client
	messageID            uint64
	pubClients           []mqtt.Client
	subClients           []mqtt.Client
	running              bool
	stopChan             chan struct{}
	payload              []byte
	maxConcurrentConnects int
	connectDelay         time.Duration
	ctx                  context.Context
	cancel               context.CancelFunc
	wg                   sync.WaitGroup
	memoryTicker         *time.Ticker

	seenMessageIDs       map[uint64]time.Time
	seenMu               sync.RWMutex
	maxSeenMessages      int

	pendingConfirms      map[uint64]time.Time
	pendingMu            sync.RWMutex
}

type MemoryStats struct {
	Alloc      uint64
	TotalAlloc uint64
	Sys        uint64
	NumGC      uint32
}

func NewClientManager(cfg *config.Config, stats *stats.Statistics, failureStats *stats.FailureInjectionStats) *ClientManager {
	ctx, cancel := context.WithCancel(context.Background())

	cm := &ClientManager{
		cfg:                  cfg,
		stats:                stats,
		failureStats:         failureStats,
		stopChan:             make(chan struct{}),
		maxConcurrentConnects: DefaultMaxConcurrentConnects,
		connectDelay:         DefaultConnectDelay,
		ctx:                  ctx,
		cancel:               cancel,
		seenMessageIDs:       make(map[uint64]time.Time),
		maxSeenMessages:      10000,
		pendingConfirms:      make(map[uint64]time.Time),
	}

	if cfg.Testing.MessageSize > 0 {
		cm.payload = make([]byte, cfg.Testing.MessageSize)
		rand.Read(cm.payload)
	}

	return cm
}

func (cm *ClientManager) SetMaxConcurrentConnects(n int) {
	if n > 0 {
		cm.maxConcurrentConnects = n
	}
}

func (cm *ClientManager) SetConnectDelay(d time.Duration) {
	if d > 0 {
		cm.connectDelay = d
	}
}

func (cm *ClientManager) Connect() error {
	tlsConfig, err := NewTLSConfig(cm.cfg.Broker.TLS)
	if err != nil {
		return fmt.Errorf("failed to create TLS config: %w", err)
	}

	clientCount := cm.cfg.Clients.Count
	cm.clients = make([]mqtt.Client, 0, clientCount)

	subscribeTopic := cm.cfg.GetSubscribeTopic()
	publishClientCount := (clientCount + 1) / 2

	sem := make(chan struct{}, cm.maxConcurrentConnects)
	errChan := make(chan error, clientCount)
	var connectWg sync.WaitGroup

	connectedCount := int64(0)
	cm.startMemoryMonitoring()

	for i := 0; i < clientCount; i++ {
		select {
		case <-cm.ctx.Done():
			return fmt.Errorf("connect cancelled")
		default:
		}

		connectWg.Add(1)
		sem <- struct{}{}

		go func(clientIdx int) {
			defer connectWg.Done()
			defer func() { <-sem }()

			opts := mqtt.NewClientOptions()
			opts.AddBroker(cm.cfg.BrokerURL())
			opts.SetClientID(fmt.Sprintf("%s-%d", cm.cfg.Clients.ClientIDPrefix, clientIdx))
			opts.SetKeepAlive(cm.cfg.Clients.KeepAlive)
			opts.SetConnectTimeout(cm.cfg.Clients.ConnectTimeout)
			opts.SetCleanSession(true)
			opts.SetAutoReconnect(true)
			opts.SetMaxReconnectInterval(10 * time.Second)

			if cm.cfg.Broker.Username != "" {
				opts.SetUsername(cm.cfg.Broker.Username)
			}
			if cm.cfg.Broker.Password != "" {
				opts.SetPassword(cm.cfg.Broker.Password)
			}

			if tlsConfig != nil {
				opts.SetTLSConfig(tlsConfig)
			}

			opts.OnConnectionLost = func(c mqtt.Client, err error) {
				fmt.Printf("Connection lost for client %d: %v\n", clientIdx, err)
			}

			client := mqtt.NewClient(opts)

			if token := client.Connect(); token.Wait() && token.Error() != nil {
				errChan <- fmt.Errorf("failed to connect client %d: %w", clientIdx, token.Error())
				return
			}

			cm.clients = append(cm.clients, client)

			if clientIdx < publishClientCount {
				cm.pubClients = append(cm.pubClients, client)
			} else {
				if token := client.Subscribe(subscribeTopic, cm.cfg.Topics.QoS, cm.onMessage); token.Wait() && token.Error() != nil {
					client.Disconnect(100)
					errChan <- fmt.Errorf("failed to subscribe client %d: %w", clientIdx, token.Error())
					return
				}
				cm.subClients = append(cm.subClients, client)
			}

			atomic.AddInt64(&connectedCount, 1)

			if clientIdx%100 == 0 && clientIdx > 0 {
				fmt.Printf("Connected %d/%d clients\n", atomic.LoadInt64(&connectedCount), clientCount)
			}
		}(i)

		time.Sleep(cm.connectDelay)
	}

	connectWg.Wait()
	close(errChan)

	var errs []error
	for err := range errChan {
		errs = append(errs, err)
	}

	if len(errs) > 0 {
		cm.Disconnect()
		return fmt.Errorf("failed to connect %d clients: %v", len(errs), errs[0])
	}

	fmt.Printf("Connected %d clients (%d publishers, %d subscribers)\n",
		len(cm.clients), len(cm.pubClients), len(cm.subClients))
	return nil
}

func (cm *ClientManager) onMessage(client mqtt.Client, msg mqtt.Message) {
	var payload MessagePayload
	if err := json.Unmarshal(msg.Payload(), &payload); err != nil {
		return
	}

	cm.seenMu.RLock()
	_, isDuplicate := cm.seenMessageIDs[payload.ID]
	cm.seenMu.RUnlock()

	if isDuplicate {
		if cm.failureStats != nil {
			cm.failureStats.IncrementDuplicateMessages(1)
		}
		return
	}

	cm.seenMu.Lock()
	cm.seenMessageIDs[payload.ID] = time.Now()
	if len(cm.seenMessageIDs) > cm.maxSeenMessages {
		for id := range cm.seenMessageIDs {
			delete(cm.seenMessageIDs, id)
			if len(cm.seenMessageIDs) <= cm.maxSeenMessages/2 {
				break
			}
		}
	}
	cm.seenMu.Unlock()

	cm.pendingMu.Lock()
	delete(cm.pendingConfirms, payload.ID)
	cm.pendingMu.Unlock()

	receiveUnixNano := time.Now().UnixNano()
	cm.stats.OnReceive(payload.ID, payload.Timestamp, receiveUnixNano)

	if cm.failureStats != nil {
		if cm.failureStats.IsInFailure() {
			cm.failureStats.IncrementMessagesDuringFailure()
		} else {
			cm.failureStats.IncrementMessagesAfterRecovery()
		}
	}
}

func (cm *ClientManager) StartPublishing() {
	cm.running = true
	interval := time.Second / time.Duration(cm.cfg.Testing.PublishRate)

	cm.wg.Add(1)
	go func() {
		defer cm.wg.Done()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-cm.stopChan:
				return
			case <-cm.ctx.Done():
				return
			case <-ticker.C:
				if !cm.running {
					return
				}
				cm.publishMessage()
			}
		}
	}()
}

func (cm *ClientManager) publishMessage() {
	id := atomic.AddUint64(&cm.messageID, 1)
	now := time.Now().UnixNano()

	payload := MessagePayload{
		ID:        id,
		Timestamp: now,
		Data:      cm.payload,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		fmt.Printf("Failed to marshal payload: %v\n", err)
		return
	}

	if len(cm.pubClients) == 0 {
		return
	}

	clientIndex := rand.Intn(len(cm.pubClients))
	client := cm.pubClients[clientIndex]

	topic := cm.cfg.GetPublishTopic()

	cm.pendingMu.Lock()
	cm.pendingConfirms[id] = time.Now()
	cm.pendingMu.Unlock()

	token := client.Publish(topic, cm.cfg.Topics.QoS, false, data)

	cm.wg.Add(1)
	go func() {
		defer cm.wg.Done()
		if token.Wait() && token.Error() != nil {
			fmt.Printf("Publish error: %v\n", token.Error())
		} else {
			cm.stats.OnPublish(id)
		}
	}()
}

func (cm *ClientManager) StopPublishing() {
	cm.running = false
	select {
	case <-cm.stopChan:
	default:
		close(cm.stopChan)
	}
	cm.wg.Wait()
}

func (cm *ClientManager) Disconnect() {
	fmt.Println("Starting graceful shutdown...")

	cm.cancel()

	cm.StopPublishing()

	if cm.memoryTicker != nil {
		cm.memoryTicker.Stop()
	}

	fmt.Printf("Disconnecting %d clients...\n", len(cm.clients))

	sem := make(chan struct{}, cm.maxConcurrentConnects)
	var wg sync.WaitGroup

	for i := len(cm.clients) - 1; i >= 0; i-- {
		client := cm.clients[i]
		if client == nil {
			continue
		}

		wg.Add(1)
		sem <- struct{}{}

		go func(c mqtt.Client, idx int) {
			defer wg.Done()
			defer func() { <-sem }()

			if c.IsConnected() {
				c.Disconnect(250)
			}
			if idx%100 == 0 {
				fmt.Printf("Disconnected %d clients...\n", len(cm.clients)-idx)
			}
		}(client, i)
	}

	wg.Wait()

	cm.clients = nil
	cm.pubClients = nil
	cm.subClients = nil

	fmt.Println("All clients disconnected gracefully")
}

func (cm *ClientManager) AddClients(count int) error {
	if count <= 0 {
		return nil
	}

	tlsConfig, err := NewTLSConfig(cm.cfg.Broker.TLS)
	if err != nil {
		return fmt.Errorf("failed to create TLS config: %w", err)
	}

	subscribeTopic := cm.cfg.GetSubscribeTopic()
	startIndex := len(cm.clients)
	newClients := make([]mqtt.Client, 0, count)

	sem := make(chan struct{}, cm.maxConcurrentConnects)
	errChan := make(chan error, count)
	var wg sync.WaitGroup

	for i := 0; i < count; i++ {
		select {
		case <-cm.ctx.Done():
			return fmt.Errorf("add clients cancelled")
		default:
		}

		wg.Add(1)
		sem <- struct{}{}

		go func(clientIdx int) {
			defer wg.Done()
			defer func() { <-sem }()

			opts := mqtt.NewClientOptions()
			opts.AddBroker(cm.cfg.BrokerURL())
			opts.SetClientID(fmt.Sprintf("%s-%d", cm.cfg.Clients.ClientIDPrefix, clientIdx))
			opts.SetKeepAlive(cm.cfg.Clients.KeepAlive)
			opts.SetConnectTimeout(cm.cfg.Clients.ConnectTimeout)
			opts.SetCleanSession(true)
			opts.SetAutoReconnect(true)

			if cm.cfg.Broker.Username != "" {
				opts.SetUsername(cm.cfg.Broker.Username)
			}
			if cm.cfg.Broker.Password != "" {
				opts.SetPassword(cm.cfg.Broker.Password)
			}

			if tlsConfig != nil {
				opts.SetTLSConfig(tlsConfig)
			}

			client := mqtt.NewClient(opts)
			if token := client.Connect(); token.Wait() && token.Error() != nil {
				errChan <- fmt.Errorf("failed to connect client %d: %w", clientIdx, token.Error())
				return
			}

			relativeIdx := clientIdx - startIndex
			if relativeIdx%2 == 0 {
				newClients = append(newClients, client)
			} else {
				if token := client.Subscribe(subscribeTopic, cm.cfg.Topics.QoS, cm.onMessage); token.Wait() && token.Error() != nil {
					client.Disconnect(100)
					errChan <- fmt.Errorf("failed to subscribe client %d: %w", clientIdx, token.Error())
					return
				}
				newClients = append(newClients, client)
			}
		}(startIndex + i)

		time.Sleep(cm.connectDelay)
	}

	wg.Wait()
	close(errChan)

	var errs []error
	for err := range errChan {
		errs = append(errs, err)
	}

	if len(errs) > 0 {
		for _, c := range newClients {
			if c != nil && c.IsConnected() {
				c.Disconnect(100)
			}
		}
		return fmt.Errorf("failed to add %d clients: %v", len(errs), errs[0])
	}

	for _, c := range newClients {
		cm.clients = append(cm.clients, c)
		idx := len(cm.clients) - 1
		if idx%2 == 0 {
			cm.pubClients = append(cm.pubClients, c)
		} else {
			cm.subClients = append(cm.subClients, c)
		}
	}

	fmt.Printf("Added %d new clients (total: %d)\n", count, len(cm.clients))
	return nil
}

func (cm *ClientManager) RemoveClients(count int) error {
	if count <= 0 {
		return nil
	}

	if count > len(cm.clients) {
		count = len(cm.clients)
	}

	sem := make(chan struct{}, cm.maxConcurrentConnects)
	var wg sync.WaitGroup

	toRemove := cm.clients[len(cm.clients)-count:]
	remaining := cm.clients[:len(cm.clients)-count]

	for i := len(toRemove) - 1; i >= 0; i-- {
		client := toRemove[i]
		if client == nil {
			continue
		}

		wg.Add(1)
		sem <- struct{}{}

		go func(c mqtt.Client) {
			defer wg.Done()
			defer func() { <-sem }()
			if c.IsConnected() {
				c.Disconnect(250)
			}
		}(client)
	}

	wg.Wait()

	cm.clients = remaining
	pubCount := (len(cm.clients) + 1) / 2
	cm.pubClients = cm.clients[:pubCount]
	cm.subClients = cm.clients[pubCount:]

	fmt.Printf("Removed %d clients (total: %d)\n", count, len(cm.clients))
	return nil
}

func (cm *ClientManager) SetPublishRate(rate int) {
	if rate <= 0 {
		return
	}

	cm.cfg.Testing.PublishRate = rate
	cm.StopPublishing()

	cm.stopChan = make(chan struct{})
	cm.StartPublishing()

	fmt.Printf("Publish rate updated to %d msg/s\n", rate)
}

func (cm *ClientManager) GetClientCount() int {
	return len(cm.clients)
}

func (cm *ClientManager) GetPublishRate() int {
	return cm.cfg.Testing.PublishRate
}

func (cm *ClientManager) startMemoryMonitoring() {
	cm.memoryTicker = time.NewTicker(30 * time.Second)

	cm.wg.Add(1)
	go func() {
		defer cm.wg.Done()
		for {
			select {
			case <-cm.ctx.Done():
				return
			case <-cm.memoryTicker.C:
				ms := cm.GetMemoryStats()
				fmt.Printf("Memory Stats: Alloc=%.2fMB, Sys=%.2fMB, NumGC=%d\n",
					float64(ms.Alloc)/1024/1024,
					float64(ms.Sys)/1024/1024,
					ms.NumGC)
			}
		}
	}()
}

func (cm *ClientManager) GetMemoryStats() *MemoryStats {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return &MemoryStats{
		Alloc:      m.Alloc,
		TotalAlloc: m.TotalAlloc,
		Sys:        m.Sys,
		NumGC:      m.NumGC,
	}
}

func (cm *ClientManager) InjectFailure() error {
	if cm.failureStats == nil {
		return fmt.Errorf("failure injection stats not initialized")
	}

	if cm.failureStats.IsInFailure() {
		return fmt.Errorf("already in failure state")
	}

	fmt.Println("\n=== Injecting Broker Failure ===")
	cm.failureStats.RecordFailure()

	unconfirmedBefore := cm.GetUnconfirmedCount()

	sem := make(chan struct{}, cm.maxConcurrentConnects)
	var wg sync.WaitGroup

	for i, client := range cm.clients {
		if client == nil {
			continue
		}

		wg.Add(1)
		sem <- struct{}{}

		go func(c mqtt.Client, idx int) {
			defer wg.Done()
			defer func() { <-sem }()

			if c.IsConnected() {
				c.Disconnect(100)
			}
		}(client, i)
	}

	wg.Wait()

	fmt.Printf("Disconnected %d clients to simulate broker failure\n", len(cm.clients))
	fmt.Printf("Unconfirmed messages at failure: %d\n", unconfirmedBefore)

	cm.failureStats.IncrementUnconfirmedMessages(unconfirmedBefore)

	go cm.reconnectClients()

	return nil
}

func (cm *ClientManager) reconnectClients() {
	tlsConfig, err := NewTLSConfig(cm.cfg.Broker.TLS)
	if err != nil {
		fmt.Printf("Failed to create TLS config for reconnection: %v\n", err)
		return
	}

	subscribeTopic := cm.cfg.GetSubscribeTopic()
	reconnectStart := time.Now()

	cm.clients = make([]mqtt.Client, 0, cm.cfg.Clients.Count)
	cm.pubClients = nil
	cm.subClients = nil

	publishClientCount := (cm.cfg.Clients.Count + 1) / 2
	sem := make(chan struct{}, cm.maxConcurrentConnects)
	errChan := make(chan error, cm.cfg.Clients.Count)
	var connectWg sync.WaitGroup
	connectedCount := int64(0)

	for i := 0; i < cm.cfg.Clients.Count; i++ {
		select {
		case <-cm.ctx.Done():
			return
		default:
		}

		connectWg.Add(1)
		sem <- struct{}{}

		go func(clientIdx int) {
			defer connectWg.Done()
			defer func() { <-sem }()

			opts := mqtt.NewClientOptions()
			opts.AddBroker(cm.cfg.BrokerURL())
			opts.SetClientID(fmt.Sprintf("%s-%d-recon", cm.cfg.Clients.ClientIDPrefix, clientIdx))
			opts.SetKeepAlive(cm.cfg.Clients.KeepAlive)
			opts.SetConnectTimeout(cm.cfg.Clients.ConnectTimeout)
			opts.SetCleanSession(true)
			opts.SetAutoReconnect(false)

			if cm.cfg.Broker.Username != "" {
				opts.SetUsername(cm.cfg.Broker.Username)
			}
			if cm.cfg.Broker.Password != "" {
				opts.SetPassword(cm.cfg.Broker.Password)
			}

			if tlsConfig != nil {
				opts.SetTLSConfig(tlsConfig)
			}

			client := mqtt.NewClient(opts)
			connected := false
			maxRetries := 5

			for retry := 0; retry < maxRetries; retry++ {
				if token := client.Connect(); token.Wait() && token.Error() != nil {
					cm.failureStats.IncrementReconnectAttempt(false)
					time.Sleep(time.Duration(retry+1) * 500 * time.Millisecond)
					continue
				}
				connected = true
				cm.failureStats.IncrementReconnectAttempt(true)
				break
			}

			if !connected {
				errChan <- fmt.Errorf("client %d failed to reconnect", clientIdx)
				return
			}

			cm.clients = append(cm.clients, client)

			if clientIdx < publishClientCount {
				cm.pubClients = append(cm.pubClients, client)
			} else {
				if token := client.Subscribe(subscribeTopic, cm.cfg.Topics.QoS, cm.onMessage); token.Wait() && token.Error() != nil {
					client.Disconnect(100)
					errChan <- fmt.Errorf("client %d failed to resubscribe", clientIdx)
					return
				}
				cm.subClients = append(cm.subClients, client)
			}

			atomic.AddInt64(&connectedCount, 1)
		}(i)

		time.Sleep(cm.connectDelay)
	}

	connectWg.Wait()
	close(errChan)

	reconnectTime := time.Since(reconnectStart)

	var errs []error
	for err := range errChan {
		errs = append(errs, err)
	}

	if len(errs) > 0 {
		fmt.Printf("Reconnection completed with %d errors\n", len(errs))
	}

	cm.failureStats.RecordRecovery(reconnectTime)

	fmt.Printf("\n=== Reconnection Complete ===\n")
	fmt.Printf("Reconnected %d/%d clients\n", atomic.LoadInt64(&connectedCount), cm.cfg.Clients.Count)
	fmt.Printf("Total reconnect time: %v\n", reconnectTime)
}

func (cm *ClientManager) GetUnconfirmedCount() uint64 {
	cm.pendingMu.RLock()
	defer cm.pendingMu.RUnlock()
	return uint64(len(cm.pendingConfirms))
}

func (cm *ClientManager) GetFailureStats() *stats.FailureInjectionStats {
	return cm.failureStats
}

func (cm *ClientManager) IsInFailure() bool {
	if cm.failureStats == nil {
		return false
	}
	return cm.failureStats.IsInFailure()
}
