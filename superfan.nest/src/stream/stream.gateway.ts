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

  private users = new Map<number, string>();

  getStreamRoom(streamId: number | string) {
    return `stream-${streamId}`;
  }

  broadcastToStream(streamId: number | string, event: string, payload: unknown) {
    if (!this.server || streamId === undefined || streamId === null) return;
    this.server.to(this.getStreamRoom(streamId)).emit(event, payload);
  }

  handleConnection(client: Socket) {
    const userId = Number(client.handshake.query.userId);

    if (userId) {
      this.users.set(userId, client.id);
      console.log(`User ${userId} connected`);
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.users.entries()) {
      if (socketId === client.id) {
        this.users.delete(userId);
        console.log(`User ${userId} disconnected`);
        break;
      }
    }
  }

  @SubscribeMessage('joinStream')
  async joinStream(
    @MessageBody() streamId: string | number,
    @ConnectedSocket() client: Socket,
  ) {
    const room = this.getStreamRoom(streamId);
    await client.join(room);
    return { message: `Joined room ${room}` };
  }

  @SubscribeMessage('joinStreamRoom')
  async joinStreamRoom(
    @MessageBody() data: { streamId?: string | number; userId?: number },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.streamId !== undefined && data?.streamId !== null) {
      const room = this.getStreamRoom(data.streamId);
      await client.join(room);
      return { message: `Joined room ${room}` };
    }

    if (data?.userId) {
      const room = `user-${data.userId}`;
      await client.join(room);
      return { message: `Joined room ${room}` };
    }

    return { message: 'No room joined' };
  }

  @SubscribeMessage('leaveStream')
  async leaveStream(
    @MessageBody() streamId: string | number,
    @ConnectedSocket() client: Socket,
  ) {
    await client.leave(this.getStreamRoom(streamId));
    return { message: 'Left stream room' };
  }

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

    this.broadcastToStream(data.streamId, 'streamMessage', {
      ...newMessage,
      streamId: data.streamId,
    });

    return newMessage;
  }

  getUserSocket(userId: number) {
    return this.users.get(userId);
  }

  @SubscribeMessage('replyComment')
  async replyMessage(
    @MessageBody()
    data: {
      userId: number;
      commentId: number;
      comment: string;
      streamId?: number;
    },
  ) {
    const reply = await this.streamingService.replyToComment(
      data.commentId,
      data.comment,
      data.userId,
    );

    const streamId =
      data.streamId ??
      (await this.streamingService.getCommentStreamId(data.commentId));

    if (streamId) {
      this.broadcastToStream(streamId, 'replyMessage', {
        ...reply,
        streamId,
      });
    }

    return reply;
  }

  @SubscribeMessage('likeComment')
  async likeComment(
    @MessageBody()
    data: {
      userId: number;
      commentId: number;
      streamId?: number;
    },
  ) {
    const result = await this.streamingService.likeComment(
      data.commentId,
      data.userId,
    );

    const streamId =
      data.streamId ??
      result?.data?.streamId ??
      (await this.streamingService.getCommentStreamId(data.commentId));

    if (streamId) {
      this.broadcastToStream(streamId, 'likeComment', {
        commentId: data.commentId,
        streamId,
        userId: data.userId,
        likesCount: result?.data?.likesCount,
        data: result?.data,
      });
    }

    return result;
  }

  @SubscribeMessage('unlikeComment')
  async unlikeComment(
    @MessageBody()
    data: {
      userId: number;
      commentId: number;
      streamId?: number;
    },
  ) {
    const result = await this.streamingService.unlikeComment(
      data.commentId,
      data.userId,
    );

    const streamId =
      data.streamId ??
      result?.data?.streamId ??
      (await this.streamingService.getCommentStreamId(data.commentId));

    if (streamId) {
      this.broadcastToStream(streamId, 'unlikeComment', {
        commentId: data.commentId,
        streamId,
        userId: data.userId,
        likesCount: result?.data?.likesCount,
        data: result?.data,
      });
    }

    return result;
  }

  @SubscribeMessage('reportComment')
  async reportComment(
    @MessageBody()
    data: {
      commentId: number;
      creatorId: number;
      userId: number;
      reason: string;
      streamId?: number;
    },
  ) {
    const result = await this.streamingService.reportComment(
      data.commentId,
      data.creatorId,
      data.userId,
      data.reason,
    );

    const streamId =
      data.streamId ??
      (await this.streamingService.getCommentStreamId(data.commentId));

    if (streamId) {
      this.broadcastToStream(streamId, 'reportComment', {
        commentId: data.commentId,
        streamId,
        userId: data.userId,
        reportsCount: result?.reportsCount,
      });
    }

    return result;
  }

  @SubscribeMessage('deleteComment')
  async deleteComment(
    @MessageBody()
    data: {
      commentId: number;
      streamId?: number;
    },
  ) {
    const deleted = await this.streamingService.deleteComment(data.commentId);

    if (deleted?.streamId) {
      this.broadcastToStream(deleted.streamId, 'deleteComment', {
        commentId: data.commentId,
        streamId: deleted.streamId,
      });
    }

    return deleted;
  }

  @SubscribeMessage('pinComment')
  async pinComment(
    @MessageBody()
    data: {
      commentId: number;
      streamId?: number;
    },
  ) {
    const pinned = await this.streamingService.pinComment(data.commentId);
    const streamId = data.streamId ?? pinned?.streamId;

    if (streamId) {
      this.broadcastToStream(streamId, 'pinComment', {
        commentId: data.commentId,
        streamId,
      });
    }

    return pinned;
  }
}
