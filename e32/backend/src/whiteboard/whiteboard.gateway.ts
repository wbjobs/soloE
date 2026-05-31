import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WhiteboardService, WhiteboardAction } from './whiteboard.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class WhiteboardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly whiteboardService: WhiteboardService) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    const rooms = Array.from(client.rooms);
    rooms.forEach((roomId) => {
      if (roomId !== client.id) {
        this.whiteboardService.leaveRoom(roomId, client.id);
        this.server.to(roomId).emit('user-left', client.id);
      }
    });
  }

  @SubscribeMessage('create-room')
  handleCreateRoom(@ConnectedSocket() client: Socket) {
    const roomId = this.whiteboardService.createRoom();
    client.join(roomId);
    this.whiteboardService.joinRoom(roomId, client.id);
    return { roomId };
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId } = data;
    if (this.whiteboardService.roomExists(roomId)) {
      client.join(roomId);
      this.whiteboardService.joinRoom(roomId, client.id);
      const users = this.whiteboardService.getRoomUsers(roomId);
      this.server.to(roomId).emit('user-joined', client.id);
      return { success: true, users };
    }
    return { success: false, message: 'Room not found' };
  }

  @SubscribeMessage('draw-action')
  handleDrawAction(
    @MessageBody() data: WhiteboardAction & { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { roomId, ...action } = data;
    action.userId = client.id;
    action.timestamp = Date.now();

    const conflictResult = this.whiteboardService.addActionWithConflictCheck(
      roomId,
      action as WhiteboardAction,
    );

    if (conflictResult.hasConflict) {
      client.emit('version-conflict', {
        shapeId: action.shapeId,
        winnerAction: conflictResult.winnerAction,
        loserAction: conflictResult.loserAction,
        winnerUserId: conflictResult.winnerUserId,
        loserUserId: conflictResult.loserUserId,
        message: '您的修改因并发编辑被覆盖',
      });
    } else {
      client.to(roomId).emit('draw-action', action);
    }
  }

  @SubscribeMessage('get-actions')
  handleGetActions(@MessageBody() data: { roomId: string }) {
    const actions = this.whiteboardService.getActions(data.roomId);
    return { actions };
  }

  @SubscribeMessage('get-recent-actions')
  handleGetRecentActions(@MessageBody() data: { roomId: string }) {
    const actions = this.whiteboardService.getRecentActions(data.roomId);
    return { actions };
  }

  @SubscribeMessage('clear-canvas')
  handleClearCanvas(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const action: WhiteboardAction = {
      type: 'clear',
      data: {},
      userId: client.id,
      timestamp: Date.now(),
      roomId: data.roomId,
    };
    this.whiteboardService.addAction(data.roomId, action);
    client.to(data.roomId).emit('clear-canvas', { userId: client.id });
  }

  @SubscribeMessage('signal')
  handleSignal(
    @MessageBody()
    data: {
      roomId: string;
      targetUserId: string;
      signalData: any;
    },
    @ConnectedSocket() client: Socket,
  ) {
    this.server.to(data.targetUserId).emit('signal', {
      fromUserId: client.id,
      signalData: data.signalData,
    });
  }
}
