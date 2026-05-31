import { v4 as uuidv4 } from 'uuid';
import { CollaborativeAction, User } from '../../shared/types';

export interface WebSocketConfig {
  url: string;
  roomId: string;
  userId: string;
  userName: string;
}

export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface EventHandlers {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onAction?: (action: CollaborativeAction) => void;
  onUserJoined?: (user: User) => void;
  onUserLeft?: (userId: string) => void;
  onUserList?: (users: User[]) => void;
  onStatusChange?: (status: WebSocketStatus) => void;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: WebSocketConfig;
  private status: WebSocketStatus = 'disconnected';
  private handlers: EventHandlers = {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(config: WebSocketConfig) {
    this.config = config;
  }

  setHandlers(handlers: EventHandlers) {
    this.handlers = handlers;
  }

  getStatus(): WebSocketStatus {
    return this.status;
  }

  setStatus(newStatus: WebSocketStatus) {
    this.status = newStatus;
    this.handlers.onStatusChange?.(newStatus);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setStatus('connecting');

      const wsUrl = new URL(this.config.url);
      wsUrl.searchParams.append('roomId', this.config.roomId);
      wsUrl.searchParams.append('userId', this.config.userId);
      wsUrl.searchParams.append('userName', this.config.userName);

      this.ws = new WebSocket(wsUrl.toString());

      this.ws.onopen = () => {
        this.setStatus('connected');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.handlers.onConnect?.();
        resolve();
      };

      this.ws.onclose = () => {
        this.setStatus('disconnected');
        this.stopHeartbeat();
        this.handlers.onDisconnect?.();

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
          setTimeout(() => {
            this.connect().catch(() => {});
          }, delay);
        }
      };

      this.ws.onerror = (error) => {
        this.setStatus('error');
        this.handlers.onError?.(new Error('WebSocket connection error'));
        reject(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
    });
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case 'action':
        this.handlers.onAction?.(message.payload);
        break;
      case 'user_joined':
        this.handlers.onUserJoined?.(message.payload);
        break;
      case 'user_left':
        this.handlers.onUserLeft?.(message.payload);
        break;
      case 'user_list':
        this.handlers.onUserList?.(message.payload);
        break;
      case 'pong':
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  sendAction(action: CollaborativeAction) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    this.ws.send(
      JSON.stringify({
        type: 'action',
        payload: action,
      })
    );
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  updateConfig(config: Partial<WebSocketConfig>) {
    this.config = { ...this.config, ...config };
  }
}

const userColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
];

export function generateUser(name?: string): User {
  const id = uuidv4();
  return {
    id,
    name: name || `用户_${id.slice(0, 6)}`,
    color: userColors[Math.floor(Math.random() * userColors.length)],
    isOnline: true,
  };
}
