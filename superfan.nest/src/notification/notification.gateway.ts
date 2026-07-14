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

@WebSocketGateway({
  cors: {
    origin: '*',
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