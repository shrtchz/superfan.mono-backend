import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../config/database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { QuizService } from '../quiz/quiz.service';
import {
  AcceptVersusDto,
  CreateVersusDto,
  FundVersusDto,
  SubmitVersusResultDto,
  ToggleReadyDto,
} from './dto/create-versus.dto';

export type VersusMatchOutcome = 'HOST_WON' | 'OPPONENT_WON' | 'DRAW';

export interface ParticipantMetrics {
  score: number;
  timeSeconds: number;
  accuracy: number;
  streak: number;
}

/**
 * Deterministic winner determination hierarchy:
 * 1) Highest score wins
 * 2) Tied score: fastest completion time wins
 * 3) Tied score and time: highest accuracy wins
 * 4) If score, time, and accuracy are equal, draw. Streak is displayed but is NOT a tie-breaker.
 */
export function determineVersusWinner(
  host: ParticipantMetrics,
  opponent: ParticipantMetrics,
): { outcome: VersusMatchOutcome; reason: string } {
  // 1) Highest score
  if (host.score > opponent.score) {
    return { outcome: 'HOST_WON', reason: 'Highest score' };
  }
  if (opponent.score > host.score) {
    return { outcome: 'OPPONENT_WON', reason: 'Highest score' };
  }

  // 2) Tied score -> fastest completion time wins
  const hostTime = Math.round(host.timeSeconds * 100) / 100;
  const oppTime = Math.round(opponent.timeSeconds * 100) / 100;
  if (hostTime < oppTime) {
    return { outcome: 'HOST_WON', reason: 'Fastest completion time' };
  }
  if (oppTime < hostTime) {
    return { outcome: 'OPPONENT_WON', reason: 'Fastest completion time' };
  }

  // 3) Tied score and time -> highest accuracy wins
  const hostAcc = Math.round(host.accuracy * 100) / 100;
  const oppAcc = Math.round(opponent.accuracy * 100) / 100;
  if (hostAcc > oppAcc) {
    return { outcome: 'HOST_WON', reason: 'Highest accuracy' };
  }
  if (oppAcc > hostAcc) {
    return { outcome: 'OPPONENT_WON', reason: 'Highest accuracy' };
  }

  // 4) All three equal -> DRAW (Streak is NOT a tie-breaker)
  return { outcome: 'DRAW', reason: 'Equal score, time, and accuracy' };
}

@Injectable()
export class VersusService {
  private readonly logger = new Logger(VersusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
    private readonly quizService: QuizService,
  ) {}

  /**
   * Helper to normalize account type string to standard 'savings' or 'checking'
   */
  public normalizeAccountType(acc: string): 'savings' | 'checking' {
    const lower = (acc || '').toLowerCase().trim();
    if (lower === 'savings') return 'savings';
    if (lower === 'checking') return 'checking';
    throw new BadRequestException(
      `Invalid funding account: '${acc}'. Must be Savings ('savings') or Checking ('checking').`,
    );
  }

  /**
   * Helper to normalize mode to 'LIVE_1V1' or 'SCHEDULE_H2H'
   */
  public normalizeMode(mode: string): 'LIVE_1V1' | 'SCHEDULE_H2H' {
    const lower = (mode || '').toLowerCase();
    if (lower.includes('live') || lower.includes('1v1')) return 'LIVE_1V1';
    if (lower.includes('schedule') || lower.includes('h2h')) return 'SCHEDULE_H2H';
    throw new BadRequestException(
      `Invalid versus mode: '${mode}'. Must be Live 1v1 or Schedule H2H.`,
    );
  }

  /**
   * Helper to emit versus event to authorized participants
   */
  public emitVersusEvent(hostId: number, opponentId: number, event: string, payload: any) {
    try {
      this.notificationGateway.sendVersusEvent([hostId, opponentId], event, payload);
    } catch (err: any) {
      this.logger.warn(`Failed to emit socket event ${event}: ${err.message}`);
    }
  }

  /**
   * Create a new versus request with atomic host escrow debit.
   */
  async createRequest(hostUserId: number, dto: CreateVersusDto) {
    if (!hostUserId || isNaN(hostUserId)) {
      throw new ForbiddenException('User not authenticated');
    }

    const cleanOpponent = (dto.opponent || '').replace(/^@/, '').trim();
    if (!cleanOpponent) {
      throw new BadRequestException('Opponent username is required');
    }

    const host = await this.prisma.user.findUnique({
      where: { id: hostUserId },
      include: { wallet: true },
    });

    if (!host) {
      throw new NotFoundException('Host user not found');
    }

    if (host.username.toLowerCase() === cleanOpponent.toLowerCase()) {
      throw new BadRequestException('You cannot challenge yourself to a Versus');
    }

    const opponent = await this.prisma.user.findFirst({
      where: {
        username: {
          equals: cleanOpponent,
          mode: 'insensitive',
        },
      },
    });

    if (!opponent) {
      throw new NotFoundException(`User @${cleanOpponent} not found`);
    }

    if (opponent.isBanned) {
      throw new BadRequestException(`User @${cleanOpponent} is currently unable to accept challenges`);
    }

    const jackpot = Number(dto.jackpot);
    const hostShare = Number(dto.hostShare);
    const opponentShare = Number(dto.opponentShare);

    if (isNaN(jackpot) || jackpot <= 0) {
      throw new BadRequestException('Jackpot must be a positive number');
    }
    if (isNaN(hostShare) || hostShare <= 0) {
      throw new BadRequestException('Your contribution must be a positive number');
    }
    if (isNaN(opponentShare) || opponentShare <= 0) {
      throw new BadRequestException("Opponent's contribution must be a positive number");
    }

    const sum = Math.round((hostShare + opponentShare) * 100) / 100;
    const roundedJackpot = Math.round(jackpot * 100) / 100;
    if (Math.abs(sum - roundedJackpot) > 0.01) {
      throw new BadRequestException(
        `Host contribution (₦${hostShare}) and opponent contribution (₦${opponentShare}) must sum exactly to jackpot (₦${jackpot})`,
      );
    }

    const accountType = this.normalizeAccountType(dto.fundingAccount);
    const mode = this.normalizeMode(dto.mode);

    const language = dto.language || host.languagePreference || 'Yoruba';
    const subject = dto.subject || host.subjectPreference || 'General';
    const level = dto.level || (host.testLevel as string) || 'Basic';
    const questionsCount = dto.questionsCount || 25;
    const durationMinutes = dto.durationMinutes || 5;

    const now = new Date();
    const expiresAt =
      mode === 'LIVE_1V1'
        ? new Date(now.getTime() + 60 * 1000)
        : new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const escrowTxRef = `VERSUS_ESCROW_${Date.now()}_${randomBytes(4).toString('hex').toUpperCase()}`;

    const createdRequest = await this.prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({
        where: { userId: hostUserId },
      });

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            userId: hostUserId,
            balance: 0,
                                  },
        });
      }

      let availableBalance = 0;
      if (accountType === 'savings') {
        availableBalance = Number(wallet.savingsBalance) || 0;
      } else {
        availableBalance = Number(wallet.checkingBalance) || 0;
        const held = await tx.walletTransaction.aggregate({
          _sum: { amount: true },
          where: {
            userId: hostUserId,
            account_type: { in: ['checking'] },
            holdUntil: { gt: now },
          },
        });
        availableBalance = Math.max(0, availableBalance - Number(held._sum.amount || 0));
      }

      if (availableBalance < hostShare) {
        const accountLabel = accountType === 'savings' ? 'Savings' : 'Checking';
        throw new BadRequestException(
          `Insufficient ${accountLabel} balance. Required: ₦${hostShare.toLocaleString()}, Available: ₦${availableBalance.toLocaleString()}`,
        );
      }

      if (accountType === 'savings') {
        await tx.wallet.update({
          where: { userId: hostUserId },
          data: {
            savingsBalance: { decrement: hostShare },
                        balance: { decrement: hostShare },
          },
        });
      } else {
        await tx.wallet.update({
          where: { userId: hostUserId },
          data: {
            checkingBalance: { decrement: hostShare },
                        balance: { decrement: hostShare },
          },
        });
      }

      await tx.walletTransaction.create({
        data: {
          userId: hostUserId,
          amount: hostShare,
          type: 'debit',
          currency: 'NGN',
          status: 'HELD',
          payment_method: 'versus_escrow',
          account_type: accountType,
          transactionType: 'VERSUS_ESCROW_DEBIT',
          trx_ref: escrowTxRef,
          reference: escrowTxRef,
          description: `Versus ${mode === 'LIVE_1V1' ? 'Live 1v1' : 'Schedule H2H'} for challenge to @${opponent.username}`,
        },
      });

      return tx.versusRequest.create({
        data: {
          hostId: hostUserId,
          opponentId: opponent.id,
          mode,
          jackpot,
          hostShare,
          opponentShare,
          hostFundingAccount: accountType,
          language,
          subject,
          level,
          questionsCount,
          durationMinutes,
          hostReady: true,
          opponentReady: false,
          opponentFunded: false,
          status: 'PENDING',
          escrowStatus: 'HELD',
          escrowTxRef,
          expiresAt,
        },
        include: {
          host: {
            select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true },
          },
          opponent: {
            select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true },
          },
        },
      });
    });

    try {
      await this.notificationService.versusRequestSent(
        opponent.id,
        host.username,
        mode === 'LIVE_1V1' ? 'Live 1v1' : 'Schedule H2H',
        jackpot,
      );
    } catch (_) {}

    this.emitVersusEvent(hostUserId, opponent.id, 'versus:updated', createdRequest);
    return createdRequest;
  }

  /**
   * Idempotent atomic refund for expired, declined, or cancelled unstarted versus requests.
   */
  async refundEscrow(
    requestId: number,
    newStatus: 'EXPIRED' | 'DECLINED' | 'CANCELLED',
  ): Promise<{ refunded: boolean; request: any }> {
    const refundRef = `VERSUS_REFUND_${Date.now()}_${randomBytes(4).toString('hex').toUpperCase()}`;

    const res = await this.prisma.$transaction(async (tx) => {
      const request = await tx.versusRequest.findUnique({
        where: { id: requestId },
        include: {
          host: { select: { id: true, username: true } },
          opponent: { select: { id: true, username: true } },
        },
      });

      if (!request) {
        throw new NotFoundException(`Versus request ${requestId} not found`);
      }

      if (request.status !== 'PENDING' && request.status !== 'ACCEPTED') {
        return { refunded: false, request };
      }

      if (request.escrowStatus !== 'HELD') {
        return { refunded: false, request };
      }

      const updated = await tx.versusRequest.update({
        where: { id: requestId },
        data: {
          status: newStatus,
          escrowStatus: 'REFUNDED',
          refundTxRef: refundRef,
        },
        include: {
          host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
          opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        },
      });

      const isHostSavings = request.hostFundingAccount === 'savings';
      if (isHostSavings) {
        await tx.wallet.update({
          where: { userId: request.hostId },
          data: {
            savingsBalance: { increment: request.hostShare },
                        balance: { increment: request.hostShare },
          },
        });
      } else {
        await tx.wallet.update({
          where: { userId: request.hostId },
          data: {
            checkingBalance: { increment: request.hostShare },
                        balance: { increment: request.hostShare },
          },
        });
      }

      await tx.walletTransaction.create({
        data: {
          userId: request.hostId,
          amount: request.hostShare,
          type: 'credit',
          currency: 'NGN',
          status: 'SUCCESS',
          payment_method: 'versus_escrow',
          account_type: isHostSavings ? 'savings' : 'checking',
          transactionType: 'VERSUS_ESCROW_REFUND',
          trx_ref: refundRef,
          reference: refundRef,
          description: `Versus Challenge - Refund for @${request.opponent.username}`,
        },
      });

      if (request.opponentFunded && request.opponentFundingAccount) {
        const oppRefundRef = `VERSUS_REFUND_OPP_${Date.now()}_${randomBytes(4).toString('hex').toUpperCase()}`;
        const isOppSavings = request.opponentFundingAccount === 'savings';
        if (isOppSavings) {
          await tx.wallet.update({
            where: { userId: request.opponentId },
            data: {
              savingsBalance: { increment: request.opponentShare },
                            balance: { increment: request.opponentShare },
            },
          });
        } else {
          await tx.wallet.update({
            where: { userId: request.opponentId },
            data: {
              checkingBalance: { increment: request.opponentShare },
                            balance: { increment: request.opponentShare },
            },
          });
        }

        await tx.walletTransaction.create({
          data: {
            userId: request.opponentId,
            amount: request.opponentShare,
            type: 'credit',
            currency: 'NGN',
            status: 'SUCCESS',
            payment_method: 'versus_escrow',
            account_type: isOppSavings ? 'savings' : 'checking',
            transactionType: 'VERSUS_ESCROW_REFUND',
            trx_ref: oppRefundRef,
            reference: oppRefundRef,
            description: `Versus Challenge - Refund for @${request.host.username}`,
          },
        });
      }

      return { refunded: true, request: updated };
    });

    if (res.refunded && res.request) {
      const hId = res.request.hostId;
      const oId = res.request.opponentId;
      if (hId && oId) {
        this.emitVersusEvent(hId, oId, 'versus:updated', res.request);
      }
    }

    return res;
  }

  /**
   * Opponent funds their share using Superfan Vault picker.
   */
  async fundOpponentShare(opponentUserId: number, requestId: number, dto: FundVersusDto) {
    const accountType = this.normalizeAccountType(dto.fundingAccount);
    const now = new Date();

    const request = await this.prisma.versusRequest.findUnique({
      where: { id: requestId },
      include: {
        host: { select: { id: true, username: true } },
        opponent: { select: { id: true, username: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(`Versus request ${requestId} not found`);
    }

    if (request.opponentId !== opponentUserId) {
      throw new ForbiddenException('You are not authorized to fund this challenge');
    }

    if (request.status !== 'PENDING' && request.status !== 'ACCEPTED') {
      throw new BadRequestException(`Cannot fund request in status '${request.status}'`);
    }

    if (request.expiresAt <= now) {
      await this.refundEscrow(requestId, 'EXPIRED');
      throw new BadRequestException('This versus request has expired');
    }

    if (request.opponentFunded) {
      return request;
    }

    const opponentTxRef = `VERSUS_ESCROW_OPP_${Date.now()}_${randomBytes(4).toString('hex').toUpperCase()}`;

    const updated = await this.prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({
        where: { userId: opponentUserId },
      });

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            userId: opponentUserId,
            balance: 0,
                                  },
        });
      }

      let availableBalance = 0;
      if (accountType === 'savings') {
        availableBalance = Number(wallet.savingsBalance) || 0;
      } else {
        availableBalance = Number(wallet.checkingBalance) || 0;
        const held = await tx.walletTransaction.aggregate({
          _sum: { amount: true },
          where: {
            userId: opponentUserId,
            account_type: { in: ['checking'] },
            holdUntil: { gt: now },
          },
        });
        availableBalance = Math.max(0, availableBalance - Number(held._sum.amount || 0));
      }

      if (availableBalance < request.opponentShare) {
        const accountLabel = accountType === 'savings' ? 'Savings' : 'Checking';
        throw new BadRequestException(
          `Insufficient ${accountLabel} balance. Required: ₦${request.opponentShare.toLocaleString()}, Available: ₦${availableBalance.toLocaleString()}`,
        );
      }

      if (accountType === 'savings') {
        await tx.wallet.update({
          where: { userId: opponentUserId },
          data: {
            savingsBalance: { decrement: request.opponentShare },
                        balance: { decrement: request.opponentShare },
          },
        });
      } else {
        await tx.wallet.update({
          where: { userId: opponentUserId },
          data: {
            checkingBalance: { decrement: request.opponentShare },
                        balance: { decrement: request.opponentShare },
          },
        });
      }

      await tx.walletTransaction.create({
        data: {
          userId: opponentUserId,
          amount: request.opponentShare,
          type: 'debit',
          currency: 'NGN',
          status: 'HELD',
          payment_method: 'versus_escrow',
          account_type: accountType,
          transactionType: 'VERSUS_ESCROW_DEBIT',
          trx_ref: opponentTxRef,
          reference: opponentTxRef,
          description: `Versus Live 1v1 for challenge to @${request.host.username}`,
        },
      });

      return tx.versusRequest.update({
        where: { id: requestId },
        data: {
          opponentFundingAccount: accountType,
          opponentFunded: true,
          opponentReady: true,
          status: 'ACCEPTED',
        },
        include: {
          host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
          opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        },
      });
    });

    try {
      await this.notificationService.versusRequestAccepted(
        request.hostId,
        request.opponent.username,
        request.mode === 'LIVE_1V1' ? 'Live 1v1' : 'Schedule H2H',
      );
    } catch (_) {}

    this.emitVersusEvent(request.hostId, request.opponentId, 'versus:updated', updated);
    return updated;
  }

  async acceptRequest(opponentUserId: number, requestId: number, dto: AcceptVersusDto) {
    return this.fundOpponentShare(opponentUserId, requestId, dto);
  }

  /**
   * Host starts match once opponent is ready and funded.
   */
  async startRequest(hostUserId: number, requestId: number) {
    const now = new Date();

    const request = await this.prisma.versusRequest.findUnique({
      where: { id: requestId },
      include: {
        host: { select: { id: true, username: true } },
        opponent: { select: { id: true, username: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(`Versus request ${requestId} not found`);
    }

    if (request.hostId !== hostUserId) {
      throw new ForbiddenException('Only the host can start this match');
    }

    if (request.status === 'STARTED') {
      return request;
    }

    if (request.status !== 'PENDING' && request.status !== 'ACCEPTED') {
      throw new BadRequestException(`Cannot start match in status '${request.status}'`);
    }

    if (request.expiresAt <= now) {
      await this.refundEscrow(requestId, 'EXPIRED');
      throw new BadRequestException('This versus match has expired');
    }

    if (!request.opponentFunded || !request.opponentReady) {
      throw new BadRequestException('Cannot start: opponent has not funded or is not ready');
    }

    const questionPack = await this.quizService.getVersusQuestionPack({
      languagePreference: request.language,
      subjectPreference: request.subject,
      testLevel: request.level,
      questionCount: request.questionsCount,
      timePreference: request.durationMinutes,
    });
    const matchRef = `MATCH_${Date.now()}_${randomBytes(4).toString('hex').toUpperCase()}`;

    const updated = await this.prisma.versusRequest.update({
      where: { id: requestId },
      data: {
        status: 'STARTED',
        startedAt: now,
        matchReference: matchRef,
        questions: JSON.parse(JSON.stringify(questionPack.quizzes)) as Prisma.InputJsonValue,
      },
      include: {
        host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
      },
    });

    this.emitVersusEvent(request.hostId, request.opponentId, 'versus:started', updated);
    this.emitVersusEvent(request.hostId, request.opponentId, 'versus:updated', updated);
    return updated;
  }

  async getMatchQuestions(userId: number, requestId: number) {
    const request = await this.prisma.versusRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException(`Versus request ${requestId} not found`);
    }
    if (request.hostId !== userId && request.opponentId !== userId) {
      throw new ForbiddenException('You are not a participant in this versus match');
    }
    if (request.status !== 'STARTED') {
      throw new BadRequestException('Questions are available once the match has started');
    }

    const questions = Array.isArray(request.questions)
      ? request.questions.map((question) => {
          if (!question || typeof question !== 'object' || Array.isArray(question)) {
            return question;
          }
          const { answer: _answer, correctAnswer: _correctAnswer, ...publicQuestion } =
            question as Record<string, unknown>;
          return publicQuestion;
        })
      : [];

    if (questions.length === 0) {
      throw new NotFoundException('Questions have not been assigned to this Versus match');
    }

    return {
      id: request.id,
      startedAt: request.startedAt,
      durationMinutes: request.durationMinutes,
      language: request.language,
      subject: request.subject,
      level: request.level,
      questionsCount: questions.length,
      questions,
    };
  }

  /**
   * Submit participant quiz results. Server locks score and checks for match finalization.
   */
  async submitResult(userId: number, requestId: number, dto: SubmitVersusResultDto) {
    const request = await this.prisma.versusRequest.findUnique({
      where: { id: requestId },
      include: {
        host: { select: { id: true, username: true } },
        opponent: { select: { id: true, username: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(`Versus match ${requestId} not found`);
    }

    if (request.hostId !== userId && request.opponentId !== userId) {
      throw new ForbiddenException('You are not a participant in this versus match');
    }

    if (['CANCELLED', 'DECLINED', 'EXPIRED'].includes(request.status)) {
      throw new BadRequestException(`Cannot submit results for ${request.status.toLowerCase()} match`);
    }

    const isHost = request.hostId === userId;
    const now = new Date();

    // Idempotent guard: if caller already submitted, return current state
    if (isHost && request.hostCompletedAt) {
      return this.getMatchResult(userId, requestId);
    }
    if (!isHost && request.opponentCompletedAt) {
      return this.getMatchResult(userId, requestId);
    }

    // Lock caller's score
    const updated = await this.prisma.versusRequest.update({
      where: { id: requestId },
      data: isHost
        ? {
            hostScore: dto.score,
            hostTimeSeconds: dto.timeSeconds,
            hostAccuracy: dto.accuracy,
            hostStreak: dto.streak,
            hostCompletedAt: now,
            ...(dto.answers ? { hostAnswers: dto.answers } : {}),
            ...(dto.questions ? { questions: dto.questions } : {}),
          }
        : {
            opponentScore: dto.score,
            opponentTimeSeconds: dto.timeSeconds,
            opponentAccuracy: dto.accuracy,
            opponentStreak: dto.streak,
            opponentCompletedAt: now,
            ...(dto.answers ? { opponentAnswers: dto.answers } : {}),
            ...(dto.questions ? { questions: dto.questions } : {}),
          },
      include: {
        host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
      },
    });

    // Check if opponent is also completed
    const bothFinished = Boolean(
      (isHost ? updated.opponentCompletedAt : updated.hostCompletedAt) &&
      (isHost ? updated.hostCompletedAt : updated.opponentCompletedAt),
    );

    if (bothFinished) {
      return this.finalizeMatchAndPayout(requestId);
    }

    // First finisher: emit result_locked
    this.emitVersusEvent(request.hostId, request.opponentId, 'versus:result_locked', {
      requestId: updated.id,
      completedUserId: userId,
    });
    this.emitVersusEvent(request.hostId, request.opponentId, 'versus:updated', updated);

    return this.getMatchResult(userId, requestId);
  }

  /**
   * Deterministic match settlement: winner payout to Savings only OR draw refund to original accounts.
   */
  async finalizeMatchAndPayout(requestId: number) {
    const payoutTxRef = `VERSUS_PAYOUT_${Date.now()}_${randomBytes(4).toString('hex').toUpperCase()}`;

    const finalized = await this.prisma.$transaction(async (tx) => {
      const match = await tx.versusRequest.findUnique({
        where: { id: requestId },
        include: {
          host: { select: { id: true, username: true } },
          opponent: { select: { id: true, username: true } },
        },
      });

      if (!match) {
        throw new NotFoundException(`Versus match ${requestId} not found`);
      }

      // Idempotency: if already paid or refunded, do not double pay/refund
      if (match.payoutStatus === 'PAID' || match.payoutStatus === 'REFUNDED') {
        return match;
      }

      if (match.hostScore === null || match.opponentScore === null) {
        throw new BadRequestException('Cannot finalize match: both players have not finished');
      }

      const hostMetrics: ParticipantMetrics = {
        score: match.hostScore ?? 0,
        timeSeconds: match.hostTimeSeconds ?? 0,
        accuracy: match.hostAccuracy ?? 0,
        streak: match.hostStreak ?? 0,
      };

      const oppMetrics: ParticipantMetrics = {
        score: match.opponentScore ?? 0,
        timeSeconds: match.opponentTimeSeconds ?? 0,
        accuracy: match.opponentAccuracy ?? 0,
        streak: match.opponentStreak ?? 0,
      };

      const { outcome } = determineVersusWinner(hostMetrics, oppMetrics);
      const now = new Date();

      if (outcome === 'HOST_WON') {
        const winnerId = match.hostId;
        const prize = match.jackpot;

        // Credit full jackpot to winner's Savings Account (savingsBalance)
        await tx.wallet.update({
          where: { userId: winnerId },
          data: {
            savingsBalance: { increment: prize },
                        balance: { increment: prize },
          },
        });

        // Record immutable ledger payout
        await tx.walletTransaction.create({
          data: {
            userId: winnerId,
            amount: prize,
            type: 'credit',
            currency: 'NGN',
            status: 'SUCCESS',
            payment_method: 'versus_jackpot',
            account_type: 'savings',
            transactionType: 'VERSUS_JACKPOT_PAYOUT',
            trx_ref: payoutTxRef,
            reference: payoutTxRef,
            description: `Versus match jackpot win payout against @${match.opponent.username}`,
          },
        });

        return tx.versusRequest.update({
          where: { id: requestId },
          data: {
            status: 'COMPLETED',
            outcome: 'HOST_WON',
            winnerId,
            jackpotWon: prize,
            payoutStatus: 'PAID',
            payoutTxRef,
            hostOutcome: 'WON',
            opponentOutcome: 'LOST',
            settledAt: now,
          },
          include: {
            host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
            opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
          },
        });
      } else if (outcome === 'OPPONENT_WON') {
        const winnerId = match.opponentId;
        const prize = match.jackpot;

        // Credit full jackpot to winner's Savings Account (savingsBalance)
        await tx.wallet.update({
          where: { userId: winnerId },
          data: {
            savingsBalance: { increment: prize },
                        balance: { increment: prize },
          },
        });

        // Record immutable ledger payout
        await tx.walletTransaction.create({
          data: {
            userId: winnerId,
            amount: prize,
            type: 'credit',
            currency: 'NGN',
            status: 'SUCCESS',
            payment_method: 'versus_jackpot',
            account_type: 'savings',
            transactionType: 'VERSUS_JACKPOT_PAYOUT',
            trx_ref: payoutTxRef,
            reference: payoutTxRef,
            description: `Versus match jackpot win payout against @${match.host.username}`,
          },
        });

        return tx.versusRequest.update({
          where: { id: requestId },
          data: {
            status: 'COMPLETED',
            outcome: 'OPPONENT_WON',
            winnerId,
            jackpotWon: prize,
            payoutStatus: 'PAID',
            payoutTxRef,
            hostOutcome: 'LOST',
            opponentOutcome: 'WON',
            settledAt: now,
          },
          include: {
            host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
            opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
          },
        });
      } else {
        // DRAW: Zero jackpot won, refund original contributions to source accounts
        const hostRefundRef = `VERSUS_DRAW_HOST_${Date.now()}_${randomBytes(3).toString('hex').toUpperCase()}`;
        const oppRefundRef = `VERSUS_DRAW_OPP_${Date.now()}_${randomBytes(3).toString('hex').toUpperCase()}`;

        // Host refund to original account
        const isHostSavings = match.hostFundingAccount === 'savings';
        const hostRefundAccount = isHostSavings ? 'savings' : 'checking';
        if (isHostSavings) {
          await tx.wallet.update({
            where: { userId: match.hostId },
            data: {
              savingsBalance: { increment: match.hostShare },
                            balance: { increment: match.hostShare },
            },
          });
        } else {
          await tx.wallet.update({
            where: { userId: match.hostId },
            data: {
              checkingBalance: { increment: match.hostShare },
                            balance: { increment: match.hostShare },
            },
          });
        }

        await tx.walletTransaction.create({
          data: {
            userId: match.hostId,
            amount: match.hostShare,
            type: 'credit',
            currency: 'NGN',
            status: 'SUCCESS',
            payment_method: 'versus_escrow',
            account_type: hostRefundAccount,
            transactionType: 'VERSUS_DRAW_REFUND',
            trx_ref: hostRefundRef,
            reference: hostRefundRef,
            description: `Versus match draw stake refund for challenge to @${match.opponent.username}`,
          },
        });

        // Opponent refund to original account
        const oppAccount = match.opponentFundingAccount || 'checking';
        const isOppSavings = oppAccount === 'savings';
        const oppRefundAccount = isOppSavings ? 'savings' : 'checking';
        if (isOppSavings) {
          await tx.wallet.update({
            where: { userId: match.opponentId },
            data: {
              savingsBalance: { increment: match.opponentShare },
                            balance: { increment: match.opponentShare },
            },
          });
        } else {
          await tx.wallet.update({
            where: { userId: match.opponentId },
            data: {
              checkingBalance: { increment: match.opponentShare },
                            balance: { increment: match.opponentShare },
            },
          });
        }

        await tx.walletTransaction.create({
          data: {
            userId: match.opponentId,
            amount: match.opponentShare,
            type: 'credit',
            currency: 'NGN',
            status: 'SUCCESS',
            payment_method: 'versus_escrow',
            account_type: oppRefundAccount,
            transactionType: 'VERSUS_DRAW_REFUND',
            trx_ref: oppRefundRef,
            reference: oppRefundRef,
            description: `Versus match draw stake refund for challenge to @${match.host.username}`,
          },
        });

        return tx.versusRequest.update({
          where: { id: requestId },
          data: {
            status: 'COMPLETED',
            outcome: 'DRAW',
            winnerId: null,
            jackpotWon: 0,
            payoutStatus: 'REFUNDED',
            payoutTxRef: `${hostRefundRef},${oppRefundRef}`,
            hostOutcome: 'DRAW',
            opponentOutcome: 'DRAW',
            settledAt: now,
          },
          include: {
            host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
            opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
          },
        });
      }
    });

    this.emitVersusEvent(finalized.hostId, finalized.opponentId, 'versus:completed', finalized);
    this.emitVersusEvent(finalized.hostId, finalized.opponentId, 'versus:updated', finalized);

    return finalized;
  }

  /**
   * Get match result with unfinished opponent masking.
   */
  async getMatchResult(userId: number, requestId: number) {
    const match = await this.prisma.versusRequest.findUnique({
      where: { id: requestId },
      include: {
        host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
      },
    });

    if (!match) {
      throw new NotFoundException(`Versus match ${requestId} not found`);
    }

    if (match.hostId !== userId && match.opponentId !== userId) {
      throw new ForbiddenException('Not a participant');
    }

    const isHost = match.hostId === userId;
    const opponentFinished = Boolean(isHost ? match.opponentCompletedAt : match.hostCompletedAt);

    // Mask opponent metrics if opponent has not yet completed
    if (!opponentFinished && match.status !== 'COMPLETED') {
      return {
        ...match,
        ...(isHost
          ? {
              opponentScore: null,
              opponentTimeSeconds: null,
              opponentAccuracy: null,
              opponentStreak: null,
            }
          : {
              hostScore: null,
              hostTimeSeconds: null,
              hostAccuracy: null,
              hostStreak: null,
            }),
      };
    }

    return match;
  }

  /**
   * Get 30-day completed matches summary (Wins, Draws, Losses).
   * Excludes non-completed, pending, cancelled, declined, or expired requests.
   */
  async get30DaysSummary(userId: number) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const completedMatches = await this.prisma.versusRequest.findMany({
      where: {
        status: 'COMPLETED',
        OR: [{ hostId: userId }, { opponentId: userId }],
        settledAt: { gte: thirtyDaysAgo },
      },
      select: {
        winnerId: true,
        outcome: true,
      },
    });

    let wins = 0;
    let draws = 0;
    let losses = 0;

    for (const m of completedMatches) {
      if (m.outcome === 'DRAW') {
        draws++;
      } else if (m.winnerId === userId) {
        wins++;
      } else {
        losses++;
      }
    }

    return { wins, draws, losses };
  }

  /**
   * Head-to-Head summary between authenticated user and a specific opponent.
   */
  async getHeadToHeadSummary(userId: number, opponentId: number) {
    const opponent = await this.prisma.user.findUnique({
      where: { id: opponentId },
      select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true },
    });

    if (!opponent) {
      throw new NotFoundException(`Opponent with ID ${opponentId} not found`);
    }

    const matches = await this.prisma.versusRequest.findMany({
      where: {
        status: 'COMPLETED',
        OR: [
          { hostId: userId, opponentId },
          { hostId: opponentId, opponentId: userId },
        ],
      },
      include: {
        host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
      },
      orderBy: [{ settledAt: 'desc' }, { createdAt: 'desc' }],
    });

    let wins = 0;
    let draws = 0;
    let losses = 0;
    let cashWon = 0;
    let personalBest: number | null = null;
    let latestUserScore: number | null = null;

    matches.forEach((m, idx) => {
      const isHost = m.hostId === userId;
      const userScore = isHost ? m.hostScore : m.opponentScore;

      if (idx === 0) {
        latestUserScore = userScore;
      }

      if (userScore !== null && userScore !== undefined) {
        if (personalBest === null || userScore > personalBest) {
          personalBest = userScore;
        }
      }

      if (m.outcome === 'DRAW') {
        draws++;
      } else if (m.winnerId === userId) {
        wins++;
        if (m.payoutStatus === 'PAID') {
          cashWon += Number(m.jackpotWon || m.jackpot || 0);
        }
      } else {
        losses++;
      }
    });

    const isNewBest = Boolean(personalBest !== null && latestUserScore !== null && latestUserScore >= personalBest);

    return {
      opponent,
      wins,
      draws,
      losses,
      cashWon,
      personalBest,
      isNewBest,
      totalMatches: matches.length,
      matches: matches.map((m) => {
        const isHost = m.hostId === userId;
        let state: 'won' | 'lost' | 'draw' = 'lost';
        if (m.outcome === 'DRAW') state = 'draw';
        else if (m.winnerId === userId) state = 'won';

        return {
          ...m,
          userResultState: state,
        };
      }),
    };
  }

  /**
   * Get paginated completed versus history for user / admin ledger newest first.
   * Derives rematch status strictly from authoritative persistence.
   */
  async getPaginatedVersusHistory(userId: number, page = 1, limit = 20) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.VersusRequestWhereInput = {
      status: 'COMPLETED',
      OR: [{ hostId: userId }, { opponentId: userId }],
    };

    const [total, matches] = await Promise.all([
      this.prisma.versusRequest.count({ where }),
      this.prisma.versusRequest.findMany({
        where,
        include: {
          host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
          opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        },
        orderBy: [{ settledAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limitNum,
      }),
    ]);

    const enriched = await Promise.all(
      matches.map(async (m) => {
        const isHost = m.hostId === userId;
        const opponent = isHost ? m.opponent : m.host;
        let state: 'won' | 'lost' | 'draw' = 'lost';
        if (m.outcome === 'DRAW') state = 'draw';
        else if (m.winnerId === userId) state = 'won';

        // Check if there was an earlier completed match between these two users
        const priorMatchCount = await this.prisma.versusRequest.count({
          where: {
            status: 'COMPLETED',
            id: { not: m.id },
            createdAt: { lt: m.createdAt },
            OR: [
              { hostId: m.hostId, opponentId: m.opponentId },
              { hostId: m.opponentId, opponentId: m.hostId },
            ],
          },
        });

        const isRematch = priorMatchCount > 0;
        const modeLabel = m.mode === 'SCHEDULE_H2H' ? 'Schedule H2H' : 'Live 1v1';
        const title = `@${opponent.username} 1v1${isRematch ? ' Rematch' : ''}`;

        return {
          ...m,
          userResultState: state,
          isRematch,
          modeLabel,
          title,
          opponent,
        };
      })
    );

    return {
      items: enriched,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    };
  }

  /**
   * Get completed versus history for user / admin ledger (legacy/backward compatibility).
   */
  async getVersusHistory(userId: number) {
    const paginated = await this.getPaginatedVersusHistory(userId, 1, 50);
    return paginated.items;
  }

  async cancelRequest(userId: number, requestId: number) {
    const request = await this.prisma.versusRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException(`Versus request ${requestId} not found`);
    }

    if (request.hostId !== userId && request.opponentId !== userId) {
      throw new ForbiddenException('You are not authorized to cancel this challenge');
    }

    if (request.status === 'STARTED' || request.status === 'COMPLETED') {
      throw new BadRequestException('Cannot cancel a match that has already started or completed');
    }

    if (request.status === 'CANCELLED' || request.status === 'DECLINED' || request.status === 'EXPIRED') {
      return request;
    }

    const { request: updated } = await this.refundEscrow(requestId, 'CANCELLED');
    return updated;
  }

  async declineRequest(opponentUserId: number, requestId: number) {
    const request = await this.prisma.versusRequest.findUnique({
      where: { id: requestId },
      include: { opponent: true },
    });

    if (!request) {
      throw new NotFoundException(`Versus request ${requestId} not found`);
    }

    if (request.opponentId !== opponentUserId) {
      throw new ForbiddenException('You are not authorized to decline this challenge');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException(`Cannot decline request in status '${request.status}'`);
    }

    const { request: updated } = await this.refundEscrow(requestId, 'DECLINED');

    try {
      await this.notificationService.versusRequestDeclined(request.hostId, request.opponent.username);
    } catch (_) {}

    return updated;
  }

  async toggleReady(userId: number, requestId: number, dto: ToggleReadyDto) {
    const request = await this.prisma.versusRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException(`Versus request ${requestId} not found`);
    }

    if (request.hostId !== userId && request.opponentId !== userId) {
      throw new ForbiddenException('Not authorized');
    }

    if (userId === request.opponentId && !request.opponentFunded && dto.ready) {
      throw new BadRequestException('You must fund your contribution before marking ready');
    }

    const updated = await this.prisma.versusRequest.update({
      where: { id: requestId },
      data: {
        opponentReady: userId === request.opponentId ? dto.ready : request.opponentReady,
        hostReady: userId === request.hostId ? dto.ready : request.hostReady,
      },
      include: {
        host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
      },
    });

    this.emitVersusEvent(request.hostId, request.opponentId, 'versus:updated', updated);
    return updated;
  }

  async getSingleRequest(userId: number, requestId: number) {
    const now = new Date();
    const request = await this.prisma.versusRequest.findUnique({
      where: { id: requestId },
      include: {
        host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(`Versus request ${requestId} not found`);
    }

    if (request.hostId !== userId && request.opponentId !== userId) {
      throw new ForbiddenException('You are not a participant in this versus match');
    }

    if (request.status === 'PENDING' && request.expiresAt <= now) {
      const { request: expired } = await this.refundEscrow(requestId, 'EXPIRED');
      return expired;
    }

    return request;
  }

  async getActiveRequests(userId: number) {
    const now = new Date();

    const pending = await this.prisma.versusRequest.findMany({
      where: {
        status: { in: ['PENDING', 'ACCEPTED'] },
        OR: [{ hostId: userId }, { opponentId: userId }],
      },
      include: {
        host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
      },
    });

    for (const req of pending) {
      if (req.status === 'PENDING' && req.expiresAt <= now) {
        await this.refundEscrow(req.id, 'EXPIRED');
        try {
          await this.notificationService.versusRequestExpired(req.hostId, req.opponent.username);
        } catch (_) {}
      }
    }

    return this.prisma.versusRequest.findMany({
      where: {
        OR: [{ hostId: userId }, { opponentId: userId }],
      },
      include: {
        host: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
        opponent: { select: { id: true, username: true, profilePicture: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async sweepExpiredRequests() {
    const now = new Date();
    const expiredList = await this.prisma.versusRequest.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lte: now },
      },
      include: {
        host: { select: { id: true, username: true } },
        opponent: { select: { id: true, username: true } },
      },
      take: 100,
    });

    let count = 0;
    for (const req of expiredList) {
      try {
        const { refunded } = await this.refundEscrow(req.id, 'EXPIRED');
        if (refunded) {
          count++;
          try {
            await this.notificationService.versusRequestExpired(req.hostId, req.opponent.username);
          } catch (_) {}
        }
      } catch (err: any) {
        this.logger.error(`Error refunding expired versus request ${req.id}: ${err.message}`);
      }
    }

    if (count > 0) {
      this.logger.log(`Versus expiry sweep: refunded ${count} expired requests.`);
    }

    return count;
  }

  /* ==========================================================================
     Admin Endpoints: Ledger, Summary, and Player Questions
     ========================================================================== */

  /**
   * Helper to format score, elapsed time, and accuracy.
   * e.g. "4/25 · 1:19 · 84%" or "—" if not completed.
   */
  private formatStatsMetric(
    score: number | null | undefined,
    timeSeconds: number | null | undefined,
    accuracy: number | null | undefined,
    questionsCount: number,
  ): string {
    if (score === null || score === undefined) return '—';
    const total = questionsCount || 25;
    const mins = Math.floor((timeSeconds || 0) / 60);
    const secs = Math.floor((timeSeconds || 0) % 60);
    const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    const accStr = accuracy !== null && accuracy !== undefined ? `${Math.round(accuracy)}%` : '0%';
    return `${score}/${total} · ${timeStr} · ${accStr}`;
  }

  /**
   * Helper to format timestamps e.g. "10/2/26" or "—".
   */
  private formatLedgerDate(d: Date | string | null | undefined): string {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '—';
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = String(date.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  }

  /**
   * Global summary metrics for Admin Versus cards.
   * Invariant: totalLive1v1 + totalScheduleH2H === totalVersus.
   * totalJackpotsWon sums confirmed paid jackpots only.
   */
  async getAdminVersusSummary() {
    const [totalVersus, scheduleMatches, paidAggregate] = await Promise.all([
      this.prisma.versusRequest.count(),
      this.prisma.versusRequest.count({
        where: {
          mode: { in: ['SCHEDULE_H2H', 'Schedule H2H', 'schedule', 'Schedule'] },
        },
      }),
      this.prisma.versusRequest.aggregate({
        _sum: { jackpotWon: true },
        where: { payoutStatus: 'PAID' },
      }),
    ]);

    const totalScheduleH2H = scheduleMatches;
    const totalLive1v1 = Math.max(0, totalVersus - totalScheduleH2H);
    const totalJackpotsWon = Number(paidAggregate._sum.jackpotWon || 0);

    return {
      totalVersus,
      totalLive1v1,
      totalScheduleH2H,
      totalJackpotsWon,
    };
  }

  /**
   * Paginated Versus Ledger for Admin Quiz page.
   * Stable newest-first ordering (createdAt desc).
   */
  async getAdminVersusLedger(page = 1, limit = 10) {
    const validPage = Math.max(1, Number(page) || 1);
    const validLimit = Math.min(100, Math.max(1, Number(limit) || 10));
    const skip = (validPage - 1) * validLimit;

    const [total, records, summary] = await Promise.all([
      this.prisma.versusRequest.count(),
      this.prisma.versusRequest.findMany({
        skip,
        take: validLimit,
        orderBy: { createdAt: 'desc' },
        include: {
          host: { select: { id: true, username: true } },
          opponent: { select: { id: true, username: true } },
        },
      }),
      this.getAdminVersusSummary(),
    ]);

    const items = records.map((r) => {
      const isCompleted = r.status === 'COMPLETED';
      const isCancelled = ['CANCELLED', 'DECLINED', 'EXPIRED'].includes(r.status);
      const isDraw = r.outcome === 'DRAW';

      // Badges: W/L/D only for finalized outcomes
      let hostOutcome: 'W' | 'L' | 'D' | null = null;
      let guestOutcome: 'W' | 'L' | 'D' | null = null;
      if (isCompleted) {
        if (isDraw) {
          hostOutcome = 'D';
          guestOutcome = 'D';
        } else if (r.winnerId === r.hostId || r.outcome === 'HOST_WON') {
          hostOutcome = 'W';
          guestOutcome = 'L';
        } else {
          hostOutcome = 'L';
          guestOutcome = 'W';
        }
      }

      // Versus Status: exactly Completed, Pending, or Cancelled
      const versusStatus: 'Completed' | 'Pending' | 'Cancelled' = isCompleted
        ? 'Completed'
        : isCancelled
        ? 'Cancelled'
        : 'Pending';

      // Payout Display: Paid, Unpaid, Refunded
      let jackpotPaymentStatus: 'Paid' | 'Unpaid' | 'Refunded' = 'Unpaid';
      if (r.payoutStatus === 'PAID') {
        jackpotPaymentStatus = 'Paid';
      } else if (r.payoutStatus === 'REFUNDED') {
        jackpotPaymentStatus = 'Refunded';
      }

      // Jackpot Won Amount: draws show NGN 0, winner shows won amount
      const jackpotAmount = isDraw ? 0 : Number(r.jackpotWon || (r.status === 'COMPLETED' ? r.jackpot : 0));
      const jackpotWonAmount = `NGN ${jackpotAmount.toLocaleString()}`;

      // Mode: Live or Schedule
      const mode: 'Live' | 'Schedule' = ['SCHEDULE_H2H', 'Schedule H2H', 'schedule', 'Schedule'].includes(r.mode)
        ? 'Schedule'
        : 'Live';

      return {
        id: String(r.id),
        hostId: r.hostId,
        hostUsername: r.host?.username || `user_${r.hostId}`,
        hostOutcome,
        guestId: r.opponentId,
        guestUsername: r.opponent?.username || `user_${r.opponentId}`,
        guestOutcome,
        questionCount: r.questionsCount || 25,
        hostStats: this.formatStatsMetric(r.hostScore, r.hostTimeSeconds, r.hostAccuracy, r.questionsCount),
        guestStats: this.formatStatsMetric(r.opponentScore, r.opponentTimeSeconds, r.opponentAccuracy, r.questionsCount),
        language: r.language || 'Yoruba',
        subject: r.subject || 'General',
        testLevel: r.level || 'Basic',
        mode,
        startDate: this.formatLedgerDate(r.startedAt || (r.status !== 'PENDING' ? r.createdAt : null)),
        endDate: this.formatLedgerDate(r.settledAt),
        jackpotWonAmount,
        jackpotPaymentStatus,
        versusStatus,
      };
    });

    return {
      items,
      total,
      page: validPage,
      limit: validLimit,
      totalPages: Math.ceil(total / validLimit) || 1,
      summary,
    };
  }

  /**
   * Retrieve answered questions for a participant in a Versus match.
   * Verifies participant access and returns question text, selected answer,
   * correctness, and correct answer when wrong. Excludes per-question time.
   */
  async getAdminPlayerQuestions(versusId: number, playerId: number) {
    const request = await this.prisma.versusRequest.findUnique({
      where: { id: versusId },
      include: {
        host: { select: { id: true, username: true } },
        opponent: { select: { id: true, username: true } },
      },
    });

    if (!request) {
      throw new NotFoundException(`Versus match ${versusId} not found`);
    }

    if (request.hostId !== playerId && request.opponentId !== playerId) {
      throw new ForbiddenException(`Player ${playerId} is not a participant in versus match ${versusId}`);
    }

    const isHost = request.hostId === playerId;
    let answers: any[] = Array.isArray((request as any).hostAnswers) && isHost
      ? (request as any).hostAnswers
      : Array.isArray((request as any).opponentAnswers) && !isHost
      ? (request as any).opponentAnswers
      : [];

    let questions: any[] = Array.isArray((request as any).questions) ? (request as any).questions : [];

    // Fallback: search OngoingQuiz for this participant if answers were not stored directly on VersusRequest
    if (answers.length === 0) {
      const ongoing = await this.prisma.ongoingQuiz.findFirst({
        where: {
          userId: playerId,
          ...(request.language ? { testQuiz: request.language.toLowerCase() } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });

      if (ongoing) {
        if (Array.isArray(ongoing.answers) && (ongoing.answers as any[]).length > 0) {
          answers = ongoing.answers as any[];
        }
        if (Array.isArray(ongoing.questions) && (ongoing.questions as any[]).length > 0) {
          questions = ongoing.questions as any[];
        }
      }
    }

    const questionsMap = new Map<string, any>();
    questions.forEach((q: any) => {
      if (q && q.id) questionsMap.set(String(q.id), q);
    });

    const formattedQuestions = answers.map((ans: any, index: number) => {
      const qObj = ans.quizId ? questionsMap.get(String(ans.quizId)) : questions[index];
      const questionText = ans.questionText || qObj?.question || `Question ${index + 1}`;
      const selectedAnswer = ans.selectedAnswer || '—';
      const isCorrect = Boolean(ans.isCorrect);
      const correctAnswer = !isCorrect ? (ans.correctAnswer || qObj?.answer || undefined) : undefined;

      return {
        questionId: ans.quizId || qObj?.id || String(index + 1),
        order: index + 1,
        questionText,
        selectedAnswer,
        isCorrect,
        ...(correctAnswer ? { correctAnswer } : {}),
      };
    });

    return {
      versusId,
      playerId,
      username: isHost ? request.host.username : request.opponent.username,
      totalQuestions: formattedQuestions.length,
      questions: formattedQuestions,
    };
  }
}
