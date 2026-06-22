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
import { StreamingService } from './stream.service';


@WebSocketGateway({
  cors: true,
})
export class StreamGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly streamingService: StreamingService) {}

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
  @SubscribeMessage('joinStreamRoom')
  async joinTaskRoom(
    @MessageBody() data: { userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `user-${data.userId}`;
    client.join(room);

    return { message: `Joined room ${room}` };
  }

//   // ✍️ User starts typing
// @SubscribeMessage('startTyping')
// handleStartTyping(
//   @MessageBody()
//   data: {
//     taskId: number;
//     userId: number;
//   },
//   @ConnectedSocket() client: Socket,
// ) {
//   const room = `task-${data.taskId}`;

//   // Emit to everyone except sender
//   client.to(room).emit('userTyping', {
//     userId: data.userId,
//     isTyping: true,
//   });
// }

// // 🛑 User stops typing
// @SubscribeMessage('stopTyping')
// handleStopTyping(
//   @MessageBody()
//   data: {
//     taskId: number;
//     userId: number;
//   },
//   @ConnectedSocket() client: Socket,
// ) {
//   const room = `task-${data.taskId}`;

//   client.to(room).emit('userTyping', {
//     userId: data.userId,
//     isTyping: false,
//   });
// }

  // 💬 Send message
  @SubscribeMessage('sendComment')
  async sendMessage(
    @MessageBody()
    data: {
      userId: number;
      streamId: number;
        comment: string;
    },
  ) {

        const newMessage = await this.streamingService.commentOnStream(
      data.streamId,
      data.comment,
      data.userId,
    );

    // 📡 Emit to room
    this.server.to(`stream-${newMessage.id}`).emit('streamMessage', newMessage);

    return newMessage;
  }

  getUserSocket(userId: number) {
  return this.users.get(userId);
}

@SubscribeMessage('replyComment')
async replyMessage(
    @MessageBody()
    data: {
        userId: number,
        commentId: number,
        comment: string
    }
) {
    const reply = await this.streamingService.replyToComment(
      data.commentId,
      data.comment,
      data.userId,
    );

    this.server.to(`comment-${data.commentId}`).emit('replyMessage', reply);

    return reply;
}

@SubscribeMessage('likeComment')
async likeComment(
    @MessageBody()
    data: {
        userId: number,
        commentId: number,
    }
) {
    const reply = await this.streamingService.likeComment(
      data.commentId,
      data.userId,
    );

    this.server.to(`comment-${data.commentId}`).emit('replyMessage', reply);

    return reply;
}

@SubscribeMessage('unlikeComment')
async unlikeComment(
    @MessageBody()
    data: {
        userId: number,
        commentId: number,
    }
) {
    const reply = await this.streamingService.unlikeComment(
      data.commentId,
      data.userId,
    );

    this.server.to(`comment-${data.commentId}`).emit('replyMessage', reply);

    return reply;
}

@SubscribeMessage('reportComment')
async reportComment(
    @MessageBody()
    data: {
      commentId: number,
      creatorId: number,
        userId: number,
        reason: string
    }
) {
    const reply = await this.streamingService.reportComment(
      data.commentId,
      data.creatorId,
      data.userId,
      data.reason
    );

    this.server.to(`comment-${data.commentId}`).emit('replyMessage', reply);

    return reply;
}

@SubscribeMessage('deleteComment')
async deleteComment(
    @MessageBody()
    data: {
      commentId: number,
    }
) {
    const delete_comment = await this.streamingService.deleteComment(
      data.commentId,
    );

    this.server.to(`comment-${data.commentId}`).emit('deleteComment', delete_comment);

    return delete_comment;
}
}
