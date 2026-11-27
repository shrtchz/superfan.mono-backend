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
import { Role } from '../common/enums/role.enum';
import { authenticateSocketClient } from '../common/utils/ws-auth.util';
import { prisma } from '../prisma/prisma';

const SOCKET_CORS_ORIGINS = [
  'http://localhost:9050',
  'http://localhost:9090',
  'https://api.superfan.ng',
  'https://manager.superfan.ng',
  'https://superfan.ng',
  'https://superfan-admin.vercel.app',
  'https://superfan-client.vercel.app',
  'https://sn1.superfan.ng',
  'https://s1.superfan.ng',
  'https://sg1.superfan.ng',
  'https://sa1.superfan.ng',
  'https://sq1.superfan.ng',
];

@WebSocketGateway({
  cors: {
    origin: SOCKET_CORS_ORIGINS,
    credentials: true,
  },
  path: '/api/v1/socket.io',
})
export class TaskChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor() {}

  private users = new Map<number, string>(); // userId -> socketId

  private isAdmin(client: Socket): boolean {
    const roleName = client.data?.roleName;
    return roleName === Role.superadmin || roleName === Role.subadmin;
  }

  private async canAccessTask(client: Socket, taskId: number): Promise<boolean> {
    const userId = Number(client.data?.userId);
    if (!Number.isFinite(userId) || userId <= 0) return false;
    if (this.isAdmin(client)) return true;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { userId: true },
    });
    return Boolean(task && task.userId === userId);
  }

  // 🔌 When user connects
  async handleConnection(client: Socket) {
    const user = await authenticateSocketClient(client);

    if (user) {
      this.users.set(user.id, client.id);
      console.log(`User ${user.id} connected`);
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
    const taskId = Number(data.taskId);
    if (!(await this.canAccessTask(client, taskId))) {
      return { status: 'error', error: 'Unauthorized' };
    }
    const room = `task-${taskId}`;
    client.join(room);

    try {
      const messages = await prisma.taskMessage.findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
      });

      const enrichedMessages = await Promise.all(
        messages.map(async (msg) => {
          const sender = await prisma.user.findUnique({
            where: { id: msg.senderId },
            select: { id: true, firstName: true, lastName: true, username: true },
          });

          const senderName = sender
            ? `${sender.firstName || ''} ${sender.lastName || ''}`.trim() || sender.username
            : 'User';

          return {
            ...msg,
            sender: sender ?? null,
            senderName,
          };
        }),
      );

      client.emit('taskMessages', enrichedMessages);
    } catch (err) {
      console.error('[TaskChatGateway] Error fetching room messages on join:', err);
    }

    return { message: `Joined room ${room}` };
  }

  // 🚪 Leave a task room
  @SubscribeMessage('leaveTaskRoom')
  async leaveTaskRoom(
    @MessageBody() data: { taskId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const taskId = Number(data.taskId);
    const room = `task-${taskId}`;
    client.leave(room);

    return { message: `Left room ${room}` };
  }

  // ✍️ User starts typing
  @SubscribeMessage('startTyping')
  handleStartTyping(
    @MessageBody()
    data: {
      taskId: number;
      userId?: number;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const verifiedUserId = Number(client.data?.userId);
    if (!Number.isFinite(verifiedUserId) || verifiedUserId <= 0) return;

    const room = `task-${data.taskId}`;

    // Emit to everyone in the room except sender
    client.to(room).emit('userTyping', {
      userId: verifiedUserId,
      isTyping: true,
    });
  }

  // 🛑 User stops typing
  @SubscribeMessage('stopTyping')
  handleStopTyping(
    @MessageBody()
    data: {
      taskId: number;
      userId?: number;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const verifiedUserId = Number(client.data?.userId);
    if (!Number.isFinite(verifiedUserId) || verifiedUserId <= 0) return;

    const room = `task-${data.taskId}`;

    client.to(room).emit('userTyping', {
      userId: verifiedUserId,
      isTyping: false,
    });
  }

  // 💬 Send message
  @SubscribeMessage('sendMessage')
  async sendMessage(
    @MessageBody()
    data: {
      taskId: number;
      senderId?: number;
      message: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const taskId = Number(data.taskId);
    const senderId = Number(client.data?.userId);
    if (!Number.isFinite(senderId) || senderId <= 0) {
      return { status: 'error', error: 'Unauthorized: authentication required' };
    }
    if (!(await this.canAccessTask(client, taskId))) {
      return { status: 'error', error: 'Forbidden' };
    }

    // ✅ Save to DB
    const newMessage = await prisma.taskMessage.create({
      data: {
        taskId,
        senderId,
        message: data.message,
      },
    });

    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
      },
    });

    const senderName = sender
      ? `${sender.firstName || ''} ${sender.lastName || ''}`.trim() || sender.username
      : 'User';

    const enrichedMessage = {
      ...newMessage,
      sender: sender ?? null,
      senderName,
    };

    // 📡 Emit to room
    this.server.to(`task-${taskId}`).emit('newMessage', enrichedMessage);

    return enrichedMessage;
  }

  // ✏️ Edit message via socket
  @SubscribeMessage('editMessage')
  async handleEditMessage(
    @MessageBody()
    data: {
      taskId: number;
      messageId: number | string;
      message: string;
      updatedAt?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const taskId = Number(data.taskId);
    const messageId = Number(data.messageId);
    const verifiedUserId = Number(client.data?.userId);
    if (!Number.isFinite(verifiedUserId) || verifiedUserId <= 0) {
      return { status: 'error', error: 'Unauthorized: authentication required' };
    }

    if (Number.isFinite(messageId) && messageId > 0 && data.message) {
      try {
        const existing = await prisma.taskMessage.findUnique({
          where: { id: messageId },
          select: { senderId: true },
        });
        if (!existing) {
          return { status: 'error', error: 'Message not found' };
        }
        if (existing.senderId !== verifiedUserId && !this.isAdmin(client)) {
          return { status: 'error', error: 'Forbidden' };
        }
        await prisma.taskMessage.update({
          where: { id: messageId },
          data: { message: data.message },
        });
      } catch (err) {
        console.error('[TaskChatGateway] Error updating message in DB:', err);
      }
    }

    const payload = {
      id: String(data.messageId),
      message: data.message,
      updatedAt: data.updatedAt || new Date().toISOString(),
    };

    client.to(`task-${taskId}`).emit('messageEdited', payload);
    return payload;
  }

  // 🗑 Delete message via socket
  @SubscribeMessage('deleteMessage')
  async handleDeleteMessage(
    @MessageBody()
    data: {
      taskId: number;
      messageId: number | string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const taskId = Number(data.taskId);
    const messageId = Number(data.messageId);
    const verifiedUserId = Number(client.data?.userId);
    if (!Number.isFinite(verifiedUserId) || verifiedUserId <= 0) {
      return { status: 'error', error: 'Unauthorized: authentication required' };
    }

    if (Number.isFinite(messageId) && messageId > 0) {
      try {
        const existing = await prisma.taskMessage.findUnique({
          where: { id: messageId },
          select: { senderId: true },
        });
        if (existing && existing.senderId !== verifiedUserId && !this.isAdmin(client)) {
          return { status: 'error', error: 'Forbidden' };
        }
        await prisma.taskMessage.delete({
          where: { id: messageId },
        });
      } catch (err) {
        // May already be deleted by REST endpoint
      }
    }

    const payload = {
      id: String(data.messageId),
    };

    client.to(`task-${taskId}`).emit('messageDeleted', payload);
    return payload;
  }

  getUserSocket(userId: number) {
    return this.users.get(userId);
  }
}
