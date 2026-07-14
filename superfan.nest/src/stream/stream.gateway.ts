import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';

import { Server, Socket } from 'socket.io';
import { StreamingService } from './stream.service';
import { QuizService } from '../quiz/quiz.service';

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
export class StreamGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly streamingService: StreamingService,
    private readonly quizService: QuizService,
  ) {}

  private users = new Map<number, string>();

  private toValidString(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  private toTimestamp(value: unknown): number {
    const asString = this.toValidString(value);
    if (!asString) return Number.NaN;
    const parsed = new Date(asString).getTime();
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  private toDisplayLiveQuiz(
    source: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!source) return null;

    const question =
      this.toValidString(source.question) ||
      this.toValidString(source.quizQuestion) ||
      this.toValidString(source.title);

    if (!question) return null;

    return {
      id:
        this.toValidString(source.id) ||
        this.toValidString(source.idHex) ||
        this.toValidString(source.quizId) ||
        this.toValidString(source._id),
      quizId:
        this.toValidString(source.id) ||
        this.toValidString(source.idHex) ||
        this.toValidString(source.quizId) ||
        this.toValidString(source._id),
      question,
      options: Array.isArray(source.options) ? source.options : [],
      answer:
        this.toValidString(source.answer) ||
        this.toValidString(source.correctAnswer) ||
        this.toValidString(source.selectedAnswer) ||
        this.toValidString(source.typedAnswer),
      typedAnswer: this.toValidString(source.typedAnswer) || undefined,
      isTypedAnswer: Boolean(source.isTypedAnswer),
      imageLink: Array.isArray(source.imageLink) ? source.imageLink : [],
      status:
        this.toValidString(source.status) ||
        this.toValidString(source.quizStatus) ||
        'scheduled',
      quizScheduleDate:
        this.toValidString(source.quizScheduleDate) ||
        this.toValidString(source.scheduleDate),
      quizFinishDate:
        this.toValidString(source.quizFinishDate) ||
        this.toValidString(source.finishDate),
      totalPrize: Number(source.totalPrize ?? source.totalPrice ?? 0) || 0,
      recipients: Number(source.recipients ?? 0) || 0,
      unitPrize: Number(source.unitPrize ?? 0) || 0,
      showAnswer: Boolean(source.showAnswer),
    };
  }

  private pickCurrentLiveQuiz(
    quizzes: Record<string, unknown>[],
  ): Record<string, unknown> | null {
    if (!quizzes.length) return null;
    const now = Date.now();
    const hasQuestion = (quiz: Record<string, unknown>) =>
      Boolean(
        this.toValidString(quiz.question) ||
          this.toValidString(quiz.quizQuestion) ||
          this.toValidString(quiz.title),
      );
    const withQuestion = quizzes.filter(hasQuestion);
    if (!withQuestion.length) return null;

    const getStart = (quiz: Record<string, unknown>) =>
      this.toTimestamp(quiz.quizScheduleDate ?? quiz.scheduleDate ?? quiz.startAt);
    const getFinish = (quiz: Record<string, unknown>) =>
      this.toTimestamp(quiz.quizFinishDate ?? quiz.finishDate ?? quiz.endAt);

    // 1) Prefer quiz within the current duration window.
    const activeQuizzes = withQuestion.filter((quiz) => {
      const startAt = getStart(quiz);
      const finishAt = getFinish(quiz);
      if (Number.isFinite(startAt) && now < startAt) return false;
      if (Number.isFinite(finishAt) && now >= finishAt) return false;
      return true;
    });

    if (activeQuizzes.length) {
      const liveQuiz = activeQuizzes.find(
        (quiz) => this.toValidString(quiz.status).toLowerCase() === 'live',
      );
      if (liveQuiz) return liveQuiz;

      return [...activeQuizzes].sort((a, b) => {
        const aStart = getStart(a);
        const bStart = getStart(b);
        const safeA = Number.isFinite(aStart) ? aStart : Number.MIN_SAFE_INTEGER;
        const safeB = Number.isFinite(bStart) ? bStart : Number.MIN_SAFE_INTEGER;
        return safeB - safeA;
      })[0];
    }

    // 2) If nothing active yet, return nearest upcoming/open question.
    const openQuizzes = withQuestion.filter((quiz) => {
      const finishAt = getFinish(quiz);
      return !Number.isFinite(finishAt) || finishAt > now;
    });

    if (openQuizzes.length) {
      const scheduled = [...openQuizzes]
      .filter((quiz) => {
        const status = this.toValidString(quiz.status).toLowerCase();
        return !status || status === 'scheduled';
      })
      .sort((a, b) => {
        const aStart = getStart(a);
        const bStart = getStart(b);
        const safeA = Number.isFinite(aStart) ? aStart : Number.MAX_SAFE_INTEGER;
        const safeB = Number.isFinite(bStart) ? bStart : Number.MAX_SAFE_INTEGER;
        return safeA - safeB;
      });

      return scheduled[0] ?? openQuizzes[0] ?? null;
    }

    // 3) Never empty fallback: return latest question from history.
    return [...withQuestion].sort((a, b) => {
      const aUpdated = this.toTimestamp(a.updatedAt ?? a.createdAt);
      const bUpdated = this.toTimestamp(b.updatedAt ?? b.createdAt);
      const safeA = Number.isFinite(aUpdated) ? aUpdated : Number.MIN_SAFE_INTEGER;
      const safeB = Number.isFinite(bUpdated) ? bUpdated : Number.MIN_SAFE_INTEGER;
      return safeB - safeA;
    })[0];
  }

  private extractLiveQuizArray(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      );
    }

    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const root = payload as Record<string, unknown>;
    const candidates = [root.data, root.result, root.quizzes, root.items];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item),
        );
      }
      if (candidate && typeof candidate === 'object') {
        const nested = candidate as Record<string, unknown>;
        if (Array.isArray(nested.data)) {
          return nested.data.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          );
        }
      }
    }

    return [];
  }

  private async getCurrentLiveQuizSnapshot(): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.quizService.getAllLiveQuiz();
      const quizzes = this.extractLiveQuizArray(response);
      const current = this.pickCurrentLiveQuiz(quizzes);
      return this.toDisplayLiveQuiz(current);
    } catch {
      return null;
    }
  }

  private async emitLiveQuizUpdate(
    action: 'created' | 'updated' | 'deleted' | 'sync' = 'sync',
    target: { streamId?: string | number; socket?: Socket } = {},
  ) {
    if (!this.server) return;

    const quiz = await this.getCurrentLiveQuizSnapshot();
    const payload = {
      action,
      quiz,
      updatedAt: new Date().toISOString(),
    };

    if (target.socket) {
      target.socket.emit('liveQuizUpdated', payload);
      return;
    }

    if (target.streamId !== undefined && target.streamId !== null) {
      this.broadcastToStream(target.streamId, 'liveQuizUpdated', payload);
      return;
    }

    this.server.emit('liveQuizUpdated', payload);
  }

  @OnEvent('liveQuiz.changed')
  async handleLiveQuizChanged(event?: { action?: 'created' | 'updated' | 'deleted' }) {
    const action = event?.action ?? 'updated';
    await this.emitLiveQuizUpdate(action);
  }

  private normalizeStreamId(streamId: number | string) {
    return String(streamId);
  }

  getStreamRoom(streamId: number | string) {
    return `stream-${this.normalizeStreamId(streamId)}`;
  }

  broadcastToStream(streamId: number | string, event: string, payload: unknown) {
    if (!this.server || streamId === undefined || streamId === null) return;
    this.server.to(this.getStreamRoom(streamId)).emit(event, payload);
  }

  private getRoomMemberCount(streamId: number | string): number {
    if (!this.server) return 0;
    const roomState = this.server.sockets.adapter.rooms.get(this.getStreamRoom(streamId));
    return roomState?.size ?? 0;
  }

  private emitStreamViewerCount(streamId: number | string) {
    if (!this.server || streamId === undefined || streamId === null) return;
    const normalizedStreamId = this.normalizeStreamId(streamId);
    const safeCount = this.getRoomMemberCount(normalizedStreamId);

    this.broadcastToStream(normalizedStreamId, 'streamViewerCount', {
      streamId: normalizedStreamId,
      count: safeCount,
      source: 'socket',
      updatedAt: new Date().toISOString(),
    });
  }

  handleConnection(client: Socket) {
    const userId = Number(client.handshake.query.userId);

    if (userId) {
      this.users.set(userId, client.id);
      console.log(`User ${userId} connected`);
    }
  }

  handleDisconnect(client: Socket) {
    const joinedStreams = (
      client.data?.joinedStreams instanceof Set
        ? Array.from(client.data.joinedStreams)
        : []
    ) as string[];

    for (const [userId, socketId] of this.users.entries()) {
      if (socketId === client.id) {
        this.users.delete(userId);
        console.log(`User ${userId} disconnected`);
        break;
      }
    }

    // Socket.io removes room membership during disconnect;
    // schedule broadcast after adapter state settles.
    setTimeout(() => {
      joinedStreams.forEach((streamId) => {
        this.emitStreamViewerCount(streamId);
      });
    }, 0);
  }

  @SubscribeMessage('joinStream')
  async joinStream(
    @MessageBody() streamId: string | number,
    @ConnectedSocket() client: Socket,
  ) {
    const normalizedStreamId = this.normalizeStreamId(streamId);
    const room = this.getStreamRoom(normalizedStreamId);
    await client.join(room);
    const joinedStreams = (client.data.joinedStreams ?? new Set<string>()) as Set<string>;
    joinedStreams.add(normalizedStreamId);
    client.data.joinedStreams = joinedStreams;
    this.emitStreamViewerCount(normalizedStreamId);
    void this.emitLiveQuizUpdate('sync', { socket: client });
    return { message: `Joined room ${room}` };
  }

  @SubscribeMessage('joinStreamRoom')
  async joinStreamRoom(
    @MessageBody() data: { streamId?: string | number; userId?: number },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.streamId !== undefined && data?.streamId !== null) {
      const normalizedStreamId = this.normalizeStreamId(data.streamId);
      const room = this.getStreamRoom(normalizedStreamId);
      await client.join(room);
      const joinedStreams = (client.data.joinedStreams ?? new Set<string>()) as Set<string>;
      joinedStreams.add(normalizedStreamId);
      client.data.joinedStreams = joinedStreams;
      this.emitStreamViewerCount(normalizedStreamId);
      void this.emitLiveQuizUpdate('sync', { socket: client });
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
    const normalizedStreamId = this.normalizeStreamId(streamId);
    await client.leave(this.getStreamRoom(normalizedStreamId));
    const joinedStreams = client.data?.joinedStreams as Set<string> | undefined;
    joinedStreams?.delete(normalizedStreamId);
    this.emitStreamViewerCount(normalizedStreamId);
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
