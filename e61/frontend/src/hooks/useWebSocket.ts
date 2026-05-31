import { useRef, useCallback } from 'react';

interface WebSocketMessage {
  type: string;
  data: any;
  sessionId?: string;
}

export const useWebSocket = (onMessage: (msg: WebSocketMessage) => void) => {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const ws = new WebSocket('ws://localhost:3001');
    ws.onopen = () => console.log('WebSocket connected');
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        onMessage(msg);
      } catch (e) {
        console.error('Parse error:', e);
      }
    };
    ws.onerror = (error) => console.error('WebSocket error:', error);
    ws.onclose = () => console.log('WebSocket closed');
    wsRef.current = ws;
  }, [onMessage]);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  return { connect, send, disconnect };
};
