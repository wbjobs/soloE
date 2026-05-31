import { Injectable } from '@nestjs/common';

export interface WhiteboardAction {
  type: 'draw' | 'rect' | 'text' | 'clear';
  data: any;
  userId: string;
  timestamp: number;
  roomId: string;
  shapeId?: string;
  version?: number;
}

export interface ConflictResult {
  hasConflict: boolean;
  winnerAction?: WhiteboardAction;
  loserAction?: WhiteboardAction;
  winnerUserId?: string;
  loserUserId?: string;
}

interface ShapeVersion {
  shapeId: string;
  version: number;
  lastAction: WhiteboardAction;
}

interface Room {
  id: string;
  users: Set<string>;
  actions: WhiteboardAction[];
  shapeVersions: Map<string, ShapeVersion>;
  createdAt: number;
}

@Injectable()
export class WhiteboardService {
  private rooms: Map<string, Room> = new Map();

  generateRoomCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  createRoom(): string {
    const roomId = this.generateRoomCode();
    this.rooms.set(roomId, {
      id: roomId,
      users: new Set(),
      actions: [],
      shapeVersions: new Map(),
      createdAt: Date.now(),
    });
    return roomId;
  }

  joinRoom(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);
    if (room) {
      room.users.add(userId);
      return true;
    }
    return false;
  }

  leaveRoom(roomId: string, userId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.users.delete(userId);
    }
  }

  roomExists(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  getRoomUsers(roomId: string): string[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.users) : [];
  }

  addActionWithConflictCheck(roomId: string, action: WhiteboardAction): ConflictResult {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { hasConflict: false };
    }

    const result: ConflictResult = { hasConflict: false };

    if (action.shapeId && action.type !== 'clear') {
      const existingVersion = room.shapeVersions.get(action.shapeId);
      
      if (existingVersion) {
        if (action.version && action.version <= existingVersion.version) {
          result.hasConflict = true;
          result.winnerAction = existingVersion.lastAction;
          result.loserAction = action;
          result.winnerUserId = existingVersion.lastAction.userId;
          result.loserUserId = action.userId;
        } else {
          room.shapeVersions.set(action.shapeId, {
            shapeId: action.shapeId,
            version: (action.version || 1),
            lastAction: action,
          });
          room.actions.push(action);
        }
      } else {
        room.shapeVersions.set(action.shapeId, {
          shapeId: action.shapeId,
          version: (action.version || 1),
          lastAction: action,
        });
        room.actions.push(action);
      }
    } else if (action.type === 'clear') {
      room.shapeVersions.clear();
      room.actions.push(action);
    } else {
      room.actions.push(action);
    }

    this.cleanupOldActions(room);
    return result;
  }

  addAction(roomId: string, action: WhiteboardAction): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.actions.push(action);
      this.cleanupOldActions(room);
    }
  }

  getActions(roomId: string): WhiteboardAction[] {
    const room = this.rooms.get(roomId);
    return room ? room.actions : [];
  }

  getRecentActions(roomId: string, minutes: number = 5): WhiteboardAction[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const cutoffTime = Date.now() - minutes * 60 * 1000;
    return room.actions.filter(a => a.timestamp >= cutoffTime);
  }

  private cleanupOldActions(room: Room): void {
    const cutoffTime = Date.now() - 5 * 60 * 1000;
    room.actions = room.actions.filter(a => a.timestamp >= cutoffTime);
    Array.from(room.shapeVersions.entries()).forEach(([shapeId, version]) => {
      if (version.lastAction.timestamp < cutoffTime) {
        room.shapeVersions.delete(shapeId);
      }
    });
  }
}
