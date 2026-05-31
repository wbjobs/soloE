package main

import (
	"bytes"
	"io"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/quic-go/quic-go"

	"quic-proxy/pkg/common"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WebSocketProxy struct {
	client *ProxyClient
	mu     sync.Mutex
}

func NewWebSocketProxy(client *ProxyClient) *WebSocketProxy {
	return &WebSocketProxy{client: client}
}

func (wp *WebSocketProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer wsConn.Close()

	sessionID := r.URL.Query().Get("session")
	if sessionID == "" {
		sessionID = "ws-" + generateRandomID(8)
	}

	targetAddr := r.URL.Query().Get("target")
	if targetAddr == "" {
		targetAddr = "/ws"
	}

	log.Printf("New WebSocket connection, session: %s, target: %s", sessionID, targetAddr)

	err = wp.client.HandleWebSocketSession(wsConn, sessionID, targetAddr)
	if err != nil {
		log.Printf("WebSocket session error: %v", err)
	}
}

func generateRandomID(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[i%len(charset)]
	}
	return string(b)
}
