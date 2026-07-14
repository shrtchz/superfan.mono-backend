import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';
import { prisma } from '../prisma/prisma';


@WebSocketGateway({
  cors: true,
  path: '/api/v1/socket.io',
})
export class TaskChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor() {}

  private users = new Map<number, string>(); // userId -> socketId

  // 🔌 When user connects
  handleConnection(client: Socket) {
    const userId = Number(client.handshake.query.userId);

    if (userId) {
      this.users.set(userId, client.id);
      console.log(`User ${userId} connected`);
    }
  }

  // ❌ When user disconnects
  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.users.entries()) {
      if (socketId === client.id) {
        this.users.delete(userId);
        console.log(`User ${userId} disconnected`);
        break;
      }
    }
  }

  // 🏠 Join a task room
  @SubscribeMessage('joinTaskRoom')
  async joinTaskRoom(
    @MessageBody() data: { taskId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `task-${data.taskId}`;
    client.join(room);

    return { message: `Joined room ${room}` };
  }

  // ✍️ User starts typing
@SubscribeMessage('startTyping')
handleStartTyping(
  @MessageBody()
  data: {
    taskId: number;
    userId: number;
  },
  @ConnectedSocket() client: Socket,
) {
  const room = `task-${data.taskId}`;

  // Emit to everyone except sender
  client.to(room).emit('userTyping', {
    userId: data.userId,
    isTyping: true,
  });
}

// 🛑 User stops typing
@SubscribeMessage('stopTyping')
handleStopTyping(
  @MessageBody()
  data: {
    taskId: number;
    userId: number;
  },
  @ConnectedSocket() client: Socket,
) {
  const room = `task-${data.taskId}`;

  client.to(room).emit('userTyping', {
    userId: data.userId,
    isTyping: false,
  });
}

  // 💬 Send message
  @SubscribeMessage('sendMessage')
  async sendMessage(
    @MessageBody()
    data: {
      taskId: number;
      senderId: number;
      message: string;
    },
  ) {
    // ✅ Save to DB
    const newMessage = await prisma.taskMessage.create({
      data: {
        taskId: data.taskId,
        senderId: data.senderId,
        message: data.message,
      },
    });

    // 📡 Emit to room
    this.server.to(`task-${data.taskId}`).emit('newMessage', newMessage);

    return newMessage;
  }

  getUserSocket(userId: number) {
  return this.users.get(userId);
}
}