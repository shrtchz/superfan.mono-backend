import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { NotificationGateway } from '../notification/notification.gateway';
import {
  CompleteSessionParticipantDto,
  CreateQuizSessionDto,
  RecordSessionAnswerDto,
} from './dto/quiz-session.dto';

export interface ScoreboardRankItem {
  rank: number;
  userId: number;
  username: string;
  displayName: string;
  profilePicture: string | null;
  score: number;
  accuracy: number;
  correctAnswers: number;
  attemptedAnswers: number;
  totalQuestions: number;
  timeSeconds: number;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  isCreator: boolean;
  completedAt?: Date | null;
}

@Injectable()
export class QuizSessionService {
  private readonly logger = new Logger(QuizSessionService.name);

  constructor(private readonly notificationGateway: NotificationGateway) {}

  /**
   * Sort participants deterministically according to quiz rules:
   * 1) Highest score wins (descending)
   * 2) Fastest time wins (ascending)
   * 3) Highest accuracy wins (descending)
   * 4) Earliest joined wins (ascending)
   */
  public sortRankings(rawParticipants: any[], creatorId: number): ScoreboardRankItem[] {
    const sorted = [...rawParticipants].sort((a, b) => {
      // 1) Score descending
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // 2) Time ascending (faster is better; 0/no time treated as end if not started)
      const aTime = a.timeSeconds || 0;
      const bTime = b.timeSeconds || 0;
      if (aTime !== bTime) {
        return aTime - bTime;
      }
      // 3) Accuracy descending
      const aAcc = a.accuracy || 0;
      const bAcc = b.accuracy || 0;
      if (bAcc !== aAcc) {
        return bAcc - aAcc;
      }
      // 4) Joined timestamp ascending
      const aJoined = new Date(a.joinedAt).getTime();
      const bJoined = new Date(b.joinedAt).getTime();
      return aJoined - bJoined;
    });

    return sorted.map((p, index) => {
      const user = p.user || {};
      const firstName = user.firstName || '';
      const lastName = user.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim();
      const displayName = fullName || user.username || `User #${p.userId}`;

      return {
        rank: index + 1,
        userId: p.userId,
        username: user.username || `user_${p.userId}`,
        displayName,
        profilePicture: user.profilePicture || null,
        score: p.score,
        accuracy: p.accuracy,
        correctAnswers: p.correctAnswers,
        attemptedAnswers: p.attemptedAnswers,
        totalQuestions: p.totalQuestions,
        timeSeconds: p.timeSeconds,
        status: p.status as 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED',
        isCreator: p.userId === creatorId,
        completedAt: p.completedAt,
      };
    });
  }

  /**
   * Create a new shared quiz session with the creator as the first participant
   */
  async createSession(creatorId: number, dto: CreateQuizSessionDto) {
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.quizSession.create({
        data: {
          creatorId,
          quizId: dto.quizId,
          quizTitle: dto.quizTitle,
          status: 'PENDING',
          participants: {
            create: {
              userId: creatorId,
              status: 'NOT_STARTED',
              score: 0,
            },
          },
        },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  profilePicture: true,
                },
              },
            },
          },
        },
      });
      return created;
    });

    return {
      success: true,
      session,
      scoreboard: this.sortRankings(session.participants, creatorId),
    };
  }

  /**
   * Retrieve session details and computed live scoreboard
   */
  async getSession(sessionId: string, currentUserId?: number) {
    const session = await prisma.quizSession.findUnique({
      where: { id: sessionId },
      include: {
        creator: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
        invitations: {
          include: {
            recipient: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Quiz session ${sessionId} not found`);
    }

    const isLocked = session.status === 'COMPLETED' && !!session.finalRankings;
    const scoreboard = isLocked
      ? (session.finalRankings as unknown as ScoreboardRankItem[])
      : this.sortRankings(session.participants, session.creatorId);

    const isParticipant = currentUserId
      ? session.participants.some((p) => p.userId === currentUserId)
      : false;
    const isCreator = currentUserId ? session.creatorId === currentUserId : false;

    return {
      session: {
        id: session.id,
        quizId: session.quizId,
        quizTitle: session.quizTitle,
        creatorId: session.creatorId,
        creator: session.creator,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        createdAt: session.createdAt,
      },
      participants: scoreboard,
      invitations: session.invitations,
      isLocked,
      isParticipant,
      isCreator,
    };
  }

  /**
   * Server-authoritative answer recording:
   * Recalculates score, accuracy, total questions, updates ranks, and broadcasts live update.
   */
  async recordAnswer(sessionId: string, userId: number, dto: RecordSessionAnswerDto) {
    const session = await prisma.quizSession.findUnique({
      where: { id: sessionId },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Quiz session ${sessionId} not found`);
    }

    if (session.status === 'COMPLETED') {
      throw new BadRequestException('This quiz session is already completed and results are locked');
    }

    const participant = session.participants.find((p) => p.userId === userId);
    if (!participant) {
      throw new ForbiddenException('User is not a registered participant in this quiz session');
    }

    if (participant.status === 'COMPLETED') {
      throw new BadRequestException('You have already completed your quiz attempt in this session');
    }

    // Authoritative calculation
    const newAttempted = participant.attemptedAnswers + 1;
    const newCorrect = dto.isCorrect ? participant.correctAnswers + 1 : participant.correctAnswers;
    const newAccuracy = newAttempted > 0 ? Math.round((newCorrect / newAttempted) * 100) : 0;
    const addedScore = Math.max(0, Math.round(dto.pointsEarned || 0));
    const newScore = participant.score + addedScore;
    const newTime = Math.round((participant.timeSeconds + Math.max(0, dto.timeTakenSeconds || 0)) * 100) / 100;

    await prisma.$transaction(async (tx) => {
      await tx.quizSessionParticipant.update({
        where: {
          sessionId_userId: {
            sessionId,
            userId,
          },
        },
        data: {
          score: newScore,
          accuracy: newAccuracy,
          correctAnswers: newCorrect,
          attemptedAnswers: newAttempted,
          totalQuestions: Math.max(participant.totalQuestions, dto.questionIndex + 1),
          timeSeconds: newTime,
          status: 'IN_PROGRESS',
          startedAt: participant.startedAt || new Date(),
        },
      });

      if (session.status === 'PENDING') {
        await tx.quizSession.update({
          where: { id: sessionId },
          data: { status: 'ACTIVE', startedAt: new Date() },
        });
      }
    });

    // Fetch fresh participants to compute live scoreboard
    const freshParticipants = await prisma.quizSessionParticipant.findMany({
      where: { sessionId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
      },
    });

    const scoreboard = this.sortRankings(freshParticipants, session.creatorId);

    // Broadcast live scoreboard update to all connected clients in the session room
    const payload = {
      sessionId,
      scoreboard,
      updatedUserId: userId,
      status: 'ACTIVE',
      timestamp: new Date().toISOString(),
    };

    this.notificationGateway.broadcastToQuizSession(sessionId, 'quiz:scoreboard_update', payload);

    // Also send directly to participant userIds for guaranteed delivery
    const participantUserIds = freshParticipants.map((p) => p.userId);
    this.notificationGateway.sendQuizEvent(participantUserIds, 'quiz:scoreboard_update', payload);

    return {
      success: true,
      scoreboard,
    };
  }

  /**
   * Complete a participant's attempt.
   * If all participants are completed, lock and persist final rankings.
   */
  async completeParticipant(
    sessionId: string,
    userId: number,
    dto?: CompleteSessionParticipantDto,
  ) {
    const session = await prisma.quizSession.findUnique({
      where: { id: sessionId },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Quiz session ${sessionId} not found`);
    }

    // If session is already completed and locked, return locked rankings
    if (session.status === 'COMPLETED' && session.finalRankings) {
      return {
        success: true,
        isCompleted: true,
        isLocked: true,
        scoreboard: session.finalRankings,
      };
    }

    const participant = session.participants.find((p) => p.userId === userId);
    if (!participant) {
      throw new ForbiddenException('User is not a participant in this session');
    }

    const updateData: any = {
      status: 'COMPLETED',
      completedAt: new Date(),
    };

    if (dto?.finalScore !== undefined && dto.finalScore > participant.score) {
      updateData.score = dto.finalScore;
    }
    if (dto?.finalAccuracy !== undefined) {
      updateData.accuracy = dto.finalAccuracy;
    }
    if (dto?.totalTimeSeconds !== undefined && dto.totalTimeSeconds > 0) {
      updateData.timeSeconds = Math.round(dto.totalTimeSeconds * 100) / 100;
    }

    await prisma.quizSessionParticipant.update({
      where: {
        sessionId_userId: {
          sessionId,
          userId,
        },
      },
      data: updateData,
    });

    // Check all participants
    const freshParticipants = await prisma.quizSessionParticipant.findMany({
      where: { sessionId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
      },
    });

    const scoreboard = this.sortRankings(freshParticipants, session.creatorId);
    const allCompleted = freshParticipants.length > 0 && freshParticipants.every((p) => p.status === 'COMPLETED');

    if (allCompleted) {
      // Finalize and lock the scoreboard
      await prisma.quizSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          finalRankings: scoreboard as any,
        },
      });

      const finalPayload = {
        sessionId,
        scoreboard,
        isCompleted: true,
        isLocked: true,
        winner: scoreboard[0] || null,
        timestamp: new Date().toISOString(),
      };

      this.notificationGateway.broadcastToQuizSession(
        sessionId,
        'quiz:session_completed',
        finalPayload,
      );

      const participantUserIds = freshParticipants.map((p) => p.userId);
      this.notificationGateway.sendQuizEvent(
        participantUserIds,
        'quiz:session_completed',
        finalPayload,
      );

      return {
        success: true,
        isCompleted: true,
        isLocked: true,
        scoreboard,
        winner: scoreboard[0] || null,
      };
    } else {
      // Update participants with live progress
      const updatePayload = {
        sessionId,
        scoreboard,
        updatedUserId: userId,
        status: session.status,
        timestamp: new Date().toISOString(),
      };

      this.notificationGateway.broadcastToQuizSession(
        sessionId,
        'quiz:scoreboard_update',
        updatePayload,
      );

      const participantUserIds = freshParticipants.map((p) => p.userId);
      this.notificationGateway.sendQuizEvent(
        participantUserIds,
        'quiz:scoreboard_update',
        updatePayload,
      );

      return {
        success: true,
        isCompleted: false,
        isLocked: false,
        scoreboard,
      };
    }
  }

  /**
   * Get current or finalized scoreboard for a session
   */
  async getScoreboard(sessionId: string) {
    const session = await prisma.quizSession.findUnique({
      where: { id: sessionId },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Quiz session ${sessionId} not found`);
    }

    if (session.status === 'COMPLETED' && session.finalRankings) {
      return {
        sessionId,
        isLocked: true,
        status: 'COMPLETED',
        scoreboard: session.finalRankings,
        winner: (session.finalRankings as any)[0] || null,
      };
    }

    const scoreboard = this.sortRankings(session.participants, session.creatorId);
    return {
      sessionId,
      isLocked: false,
      status: session.status,
      scoreboard,
      winner: scoreboard.length > 0 && session.status === 'COMPLETED' ? scoreboard[0] : null,
    };
  }
}
