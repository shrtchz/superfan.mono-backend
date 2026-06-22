import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway()
export class PresenceGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;



  private onlineUsers = new Map<number, string>();

  handleConnection(client: Socket) {
    const userId = Number(client.handshake.query.userId);

    if (userId) {
      this.onlineUsers.set(userId, client.id);
      console.log(`User ${userId} is online`);
    }
  }

async handleDisconnect(client: Socket) {
  for (const [userId, socketId] of this.onlineUsers.entries()) {
    if (socketId === client.id) {
      this.onlineUsers.delete(userId);

      console.log(`User ${userId} is offline`);
      break;
    }
  }
}

  isUserOnline(userId: number) {
    return this.onlineUsers.has(userId);
  }

    // ✅ manual trigger (VERY IMPORTANT)
  setUserOnline(userId: number) {
    this.server.emit('userOnline', { userId });
  }

  setUserOffline(userId: number) {
    this.server.emit('userOffline', { userId });
  }
}