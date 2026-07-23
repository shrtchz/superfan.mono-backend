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

  private clients: Map<number, string> = new Map(); // userId -> socketId

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  registerUser(userId: number, client: Socket) {
    this.clients.set(userId, client.id);
  }

  sendNotificationToUser(userId: number, notification: any) {
    const socketId = this.clients.get(userId);

    if (socketId) {
      this.server.to(socketId).emit('notification', notification);
    }
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
  @MessageBody() userId: number,
  @ConnectedSocket() client: Socket,
) {
  this.registerUser(userId, client);
}
}