import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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
import { QuizService } from '../quiz/quiz.service';
import { StreamingService } from './stream.service';

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
  private readonly logger = new Logger(StreamGateway.name);

  constructor(
    private readonly streamingService: StreamingService,
    private readonly quizService: QuizService,
  ) {}

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

    return [...withQuestion].sort((a, b) => {
      const aUpdated = this.toTimestamp(a.updatedAt ?? a.createdAt);
      const bUpdated = this.toTimestamp(b.updatedAt ?? b.createdAt);
      const safeA = Number.isFinite(aUpdated) ? aUpdated : Number.MIN_SAFE_INTEGER;
      const safeB = Number.isFinite(bUpdated) ? bUpdated : Number.MIN_SAFE_INTEGER;
      return safeB - safeA;
    })[0];
  }

  private extractLiveQuizArray(payload: unknown): Record<string, unknown>[] {
    const asRecords = (value: unknown): Record<string, unknown>[] =>
      Array.isArray(value)
        ? value.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          )
        : [];

    const tryCollect = (value: unknown): Record<string, unknown>[] => {
      const direct = asRecords(value);
      if (direct.length) return direct;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

      const node = value as Record<string, unknown>;
      const nextCandidates = [
        node.data,
        node.result,
        node.quizzes,
        node.items,
        node.questions,
      ];

      for (const candidate of nextCandidates) {
        const nested = asRecords(candidate);
        if (nested.length) return nested;
      }

      for (const candidate of nextCandidates) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          continue;
        }
        const deepNode = candidate as Record<string, unknown>;
        const deepCandidates = [
          deepNode.data,
          deepNode.result,
          deepNode.quizzes,
          deepNode.items,
          deepNode.questions,
        ];
        for (const deep of deepCandidates) {
          const deepRecords = asRecords(deep);
          if (deepRecords.length) return deepRecords;
        }
      }

      return [];
    };

    return tryCollect(payload);
  }

  private async getCurrentLiveQuizSnapshot(): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.quizService.getAllLiveQuiz();
      const quizzes = this.extractLiveQuizArray(response);
      const current = this.pickCurrentLiveQuiz(quizzes);
      const displayQuiz = this.toDisplayLiveQuiz(current);
      this.logger.log(
        `[LiveQuiz] fetched=${quizzes.length} selectedId=${displayQuiz?.id ?? 'none'} question=${displayQuiz?.question ?? 'none'}`,
      );
      return displayQuiz;
    } catch {
      this.logger.warn('[LiveQuiz] failed to fetch current snapshot');
      return null;
    }
  }

  private async emitLiveQuizUpdate(
    action: 'created' | 'updated' | 'deleted' | 'sync' = 'sync',
    socket?: Socket,
  ) {
    if (!this.server) return;

    const quiz = await this.getCurrentLiveQuizSnapshot();
    const payload = {
      action,
      quiz,
      updatedAt: new Date().toISOString(),
    };
    this.logger.log(
      `[LiveQuiz] emit action=${action} quizId=${(quiz as any)?.id ?? 'none'}`,
    );

    if (socket) {
      socket.emit('liveQuizUpdated', payload);
      return;
    }

    this.server.emit('liveQuizUpdated', payload);
  }

  @OnEvent('liveQuiz.changed')
  async handleLiveQuizChanged(event?: { action?: 'created' | 'updated' | 'deleted' }) {
    const action = event?.action ?? 'updated';
    await this.emitLiveQuizUpdate(action);
  }

  handleConnection(client: Socket) {
    // Connection handled - no chat room management
  }

  handleDisconnect(client: Socket) {
    // Disconnect handled - no chat room cleanup needed
  }

  @SubscribeMessage('joinStream')
  async joinStream(
    @MessageBody() streamId: string | number,
    @ConnectedSocket() client: Socket,
  ) {
    // Join stream for quiz updates
    const normalizedStreamId = String(streamId);
    const room = `stream-${normalizedStreamId}`;
    await client.join(room);
    void this.emitLiveQuizUpdate('sync', client);
    return { message: `Joined room ${room}` };
  }

  @SubscribeMessage('leaveStream')
  async leaveStream(
    @MessageBody() streamId: string | number,
    @ConnectedSocket() client: Socket,
  ) {
    const normalizedStreamId = String(streamId);
    await client.leave(`stream-${normalizedStreamId}`);
    return { message: 'Left stream room' };
  }

  broadcastChat(event: string, payload: any, streamId?: string | number) {
    if (!this.server) return;

    if (streamId) {
      const room = `stream-${String(streamId)}`;
      this.server.to(room).emit(event, payload);
      this.logger.log(`[StreamGateway] broadcastChat event=${event} room=${room}`);
    } else {
      this.server.emit(event, payload);
      this.logger.log(`[StreamGateway] broadcastChat event=${event} global`);
    }
  }

  @SubscribeMessage('sendComment')
  async sendComment(
    @MessageBody() payload: { streamId: string | number; message: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { streamId, message } = payload;
      this.logger.log(`[StreamGateway] sendComment streamId=${streamId} message=${message}`);
      
      // Emit the comment to all clients in the stream room
      const room = `stream-${String(streamId)}`;
      const commentPayload = {
        id: `temp-${Date.now()}`,
        streamId,
        message,
        createdAt: new Date().toISOString(),
      };
      
      this.server.to(room).emit('newComment', commentPayload);
      
      return { status: 'success' };
    } catch (error) {
      this.logger.error('[StreamGateway] sendComment error:', error);
      return { status: 'error', error: 'Failed to send comment' };
    }
  }

  @SubscribeMessage('fetchComments')
  async fetchComments(
    @MessageBody() payload: { streamId: string | number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { streamId } = payload;
      this.logger.log(`[StreamGateway] fetchComments streamId=${streamId}`);
      
      // Return empty array for now - this should fetch from database
      const comments = await this.streamingService.getStreamCommentsandReplies(Number(streamId));
      
      return { status: 'success', comments };
    } catch (error) {
      this.logger.error('[StreamGateway] fetchComments error:', error);
      return { status: 'error', error: 'Failed to fetch comments', comments: [] };
    }
  }
}