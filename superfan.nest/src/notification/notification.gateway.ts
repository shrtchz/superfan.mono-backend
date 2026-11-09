import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

const SOCKET_CORS_ORIGINS = [
  'http://localhost:9050',
  'http://localhost:9090',
  'https://api.superfan.ng',
  'https://superfan-admin.vercel.app',
  'https://superfan-client.vercel.app',
  'https://sn1.superfan.ng',
  'https://s1.superfan.ng',
  'https://sg1.superfan.ng',
  'https://sa1.superfan.ng',
];

@WebSocketGateway({
  cors: {
    origin: SOCKET_CORS_ORIGINS,
    credentials: true,
  },
  path: '/api/v1/socket.io',
})
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private clients: Map<string, string> = new Map(); // userId -> socketId

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  registerUser(userId: number | string, client: Socket) {
    this.clients.set(String(userId), client.id);
  }

  sendNotificationToUser(userId: number | string, notification: any) {
    const socketId = this.clients.get(String(userId));

    if (socketId) {
      this.server.to(socketId).emit('notification', notification);
    }
  }

  sendVersusEvent(userIds: (number | string)[], event: string, payload: any) {
    if (!this.server) return;
    for (const uid of userIds) {
      const socketId = this.clients.get(String(uid));
      if (socketId) {
        this.server.to(socketId).emit(event, payload);
      }
    }
  }

  sendQuizEvent(userIds: (number | string)[], event: string, payload: any) {
    if (!this.server) return;
    for (const uid of userIds) {
      const socketId = this.clients.get(String(uid));
      if (socketId) {
        this.server.to(socketId).emit(event, payload);
      }
    }
  }

  broadcastToQuizSession(sessionId: string, event: string, payload: any) {
    if (!this.server) return;
    this.server.to(`quiz_session_${sessionId}`).emit(event, payload);
  }

  broadcastNotification(notification: any) {
    this.server.emit('notification', notification);
  }

  /**
   * Send notification to all connected users (broadcast)
   */
  sendNotificationToAllUsers(notification: any) {
    this.server.emit('push-notification', notification);
  }

  @SubscribeMessage('register')
  handleRegister(
    @MessageBody() userId: number | string,
    @ConnectedSocket() client: Socket,
  ) {
    this.registerUser(userId, client);
  }

  @SubscribeMessage('quiz:join_session')
  handleJoinQuizSession(
    @MessageBody() data: { sessionId: string; userId?: number | string },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.sessionId) {
      client.join(`quiz_session_${data.sessionId}`);
      if (data.userId) {
        this.registerUser(data.userId, client);
      }
    }
  }

  @SubscribeMessage('quiz:leave_session')
  handleLeaveQuizSession(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.sessionId) {
      client.leave(`quiz_session_${data.sessionId}`);
    }
  }
}
