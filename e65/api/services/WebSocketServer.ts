import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { CollaborativeAction, User } from '../../shared/types';

interface RoomUser extends User {
  ws: WebSocket;
}

interface Room {
  id: string;
  users: Map<string, RoomUser>;
}

export class PointCloudWebSocketServer {
  private wss: WebSocketServer;
  private rooms: Map<string, Room> = new Map();
  private heartbeatInterval: NodeJS.Timeout;

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.setupHandlers();
    this.heartbeatInterval = setInterval(() => this.checkHeartbeats(), 30000);
  }

  private setupHandlers() {
    this.wss.on('connection', (ws: WebSocket, request) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      const roomId = url.searchParams.get('roomId') || 'default';
      const userId = url.searchParams.get('userId') || 'anonymous';
      const userName = url.searchParams.get('userName') || 'Anonymous';

      console.log(`[WS] User ${userName} (${userId}) joining room ${roomId}`);

      let room = this.rooms.get(roomId);
      if (!room) {
        room = { id: roomId, users: new Map() };
        this.rooms.set(roomId, room);
      }

      const userColors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
        '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
      ];

      const roomUser: RoomUser = {
        id: userId,
        name: userName,
        color: userColors[Math.floor(Math.random() * userColors.length)],
        isOnline: true,
        ws,
      };

      room.users.set(userId, roomUser);

      this.sendUserList(room);

      this.broadcastToRoom(roomId, {
        type: 'user_joined',
        payload: {
          id: userId,
          name: userName,
          color: roomUser.color,
          isOnline: true,
        },
      }, userId);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, roomId, userId, message);
        } catch (error) {
          console.error('[WS] Failed to parse message:', error);
        }
      });

      ws.on('close', () => {
        console.log(`[WS] User ${userName} (${userId}) left room ${roomId}`);
        this.handleUserDisconnect(roomId, userId);
      });

      ws.on('error', (error) => {
        console.error('[WS] WebSocket error:', error);
      });
    });
  }

  private handleMessage(ws: WebSocket, roomId: string, userId: string, message: any) {
    switch (message.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'action':
        this.broadcastToRoom(roomId, {
          type: 'action',
          payload: message.payload,
        }, userId);
        break;
      default:
        console.warn('[WS] Unknown message type:', message.type);
    }
  }

  private handleUserDisconnect(roomId: string, userId: string) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.users.delete(userId);

      this.broadcastToRoom(roomId, {
        type: 'user_left',
        payload: userId,
      });

      if (room.users.size === 0) {
        this.rooms.delete(roomId);
        console.log(`[WS] Room ${roomId} closed (no users left)`);
      } else {
        this.sendUserList(room);
      }
    }
  }

  private sendUserList(room: Room) {
    const users: User[] = Array.from(room.users.values()).map((u) => ({
      id: u.id,
      name: u.name,
      color: u.color,
      isOnline: u.isOnline,
    }));

    const message = JSON.stringify({
      type: 'user_list',
      payload: users,
    });

    room.users.forEach((user) => {
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(message);
      }
    });
  }

  private broadcastToRoom(roomId: string, message: any, excludeUserId?: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const messageStr = JSON.stringify(message);

    room.users.forEach((user) => {
      if (excludeUserId && user.id === excludeUserId) return;
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(messageStr);
      }
    });
  }

  private checkHeartbeats() {
    this.rooms.forEach((room) => {
      room.users.forEach((user) => {
        if (user.ws.readyState !== WebSocket.OPEN) {
          this.handleUserDisconnect(room.id, user.id);
        }
      });
    });
  }

  getRoomUserCount(roomId: string): number {
    const room = this.rooms.get(roomId);
    return room?.users.size || 0;
  }

  getRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }

  close() {
    clearInterval(this.heartbeatInterval);
    this.rooms.forEach((room) => {
      room.users.forEach((user) => user.ws.close());
    });
    this.wss.close();
  }
}
