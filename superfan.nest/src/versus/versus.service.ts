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
import {
  AcceptVersusDto,
  CreateVersusDto,
  FundVersusDto,
  ToggleReadyDto,
} from './dto/create-versus.dto';

@Injectable()
export class VersusService {
  private readonly logger = new Logger(VersusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  /**
   * Helper to normalize account type string to standard 'gold' (Savings) or 'personal' (Checking)
   */
  public normalizeAccountType(acc: string): 'gold' | 'personal' {
    const lower = (acc || '').toLowerCase().trim();
    if (lower === 'gold' || lower === 'savings') return 'gold';
    if (lower === 'personal' || lower === 'checking') return 'personal';
    throw new BadRequestException(
      `Invalid funding account: '${acc}'. Must be Savings ('gold') or Checking ('personal').`,
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
  private emitVersusEvent(hostId: number, opponentId: number, event: string, payload: any) {
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

    // Metadata defaults
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
            goldBalance: 0,
            personalBalance: 0,
          },
        });
      }

      let availableBalance = 0;
      if (accountType === 'gold') {
        availableBalance = Number(wallet.goldBalance) || 0;
      } else {
        availableBalance = Number(wallet.personalBalance) || 0;
        const held = await tx.walletTransaction.aggregate({
          _sum: { amount: true },
          where: {
            userId: hostUserId,
            account_type: 'personal',
            holdUntil: { gt: now },
          },
        });
        availableBalance = Math.max(0, availableBalance - Number(held._sum.amount || 0));
      }

      if (availableBalance < hostShare) {
        const accountLabel = accountType === 'gold' ? 'Savings' : 'Checking';
        throw new BadRequestException(
          `Insufficient ${accountLabel} balance. Required: ₦${hostShare.toLocaleString()}, Available: ₦${availableBalance.toLocaleString()}`,
        );
      }

      if (accountType === 'gold') {
        await tx.wallet.update({
          where: { userId: hostUserId },
          data: {
            goldBalance: { decrement: hostShare },
            balance: { decrement: hostShare },
          },
        });
      } else {
        await tx.wallet.update({
          where: { userId: hostUserId },
          data: {
            personalBalance: { decrement: hostShare },
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
          description: `Versus ${mode === 'LIVE_1V1' ? 'Live 1v1' : 'Schedule H2H'} escrow hold for challenge to @${opponent.username}`,
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

      // Update status
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

      // Refund host
      if (request.hostFundingAccount === 'gold') {
        await tx.wallet.update({
          where: { userId: request.hostId },
          data: {
            goldBalance: { increment: request.hostShare },
            balance: { increment: request.hostShare },
          },
        });
      } else {
        await tx.wallet.update({
          where: { userId: request.hostId },
          data: {
            personalBalance: { increment: request.hostShare },
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
          account_type: request.hostFundingAccount,
          transactionType: 'VERSUS_ESCROW_REFUND',
          trx_ref: refundRef,
          reference: refundRef,
          description: `Versus challenge ${newStatus.toLowerCase()} escrow refund for challenge to @${request.opponent.username}`,
        },
      });

      // If opponent was also funded, refund opponent too!
      if (request.opponentFunded && request.opponentFundingAccount) {
        const oppRefundRef = `VERSUS_REFUND_OPP_${Date.now()}_${randomBytes(4).toString('hex').toUpperCase()}`;
        if (request.opponentFundingAccount === 'gold') {
          await tx.wallet.update({
            where: { userId: request.opponentId },
            data: {
              goldBalance: { increment: request.opponentShare },
              balance: { increment: request.opponentShare },
            },
          });
        } else {
          await tx.wallet.update({
            where: { userId: request.opponentId },
            data: {
              personalBalance: { increment: request.opponentShare },
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
            account_type: request.opponentFundingAccount,
            transactionType: 'VERSUS_ESCROW_REFUND',
            trx_ref: oppRefundRef,
            reference: oppRefundRef,
            description: `Versus challenge ${newStatus.toLowerCase()} escrow refund for match against @${request.host.username}`,
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
   * Opponent funds their share using Superfan Vault picker without auto-starting match.
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
            goldBalance: 0,
            personalBalance: 0,
          },
        });
      }

      let availableBalance = 0;
      if (accountType === 'gold') {
        availableBalance = Number(wallet.goldBalance) || 0;
      } else {
        availableBalance = Number(wallet.personalBalance) || 0;
        const held = await tx.walletTransaction.aggregate({
          _sum: { amount: true },
          where: {
            userId: opponentUserId,
            account_type: 'personal',
            holdUntil: { gt: now },
          },
        });
        availableBalance = Math.max(0, availableBalance - Number(held._sum.amount || 0));
      }

      if (availableBalance < request.opponentShare) {
        const accountLabel = accountType === 'gold' ? 'Savings' : 'Checking';
        throw new BadRequestException(
          `Insufficient ${accountLabel} balance. Required: ₦${request.opponentShare.toLocaleString()}, Available: ₦${availableBalance.toLocaleString()}`,
        );
      }

      if (accountType === 'gold') {
        await tx.wallet.update({
          where: { userId: opponentUserId },
          data: {
            goldBalance: { decrement: request.opponentShare },
            balance: { decrement: request.opponentShare },
          },
        });
      } else {
        await tx.wallet.update({
          where: { userId: opponentUserId },
          data: {
            personalBalance: { decrement: request.opponentShare },
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
          description: `Versus escrow funding for match against @${request.host.username}`,
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

  /**
   * Opponent accepts request and funds their share (convenience wrapper around funding).
   */
  async acceptRequest(opponentUserId: number, requestId: number, dto: AcceptVersusDto) {
    return this.fundOpponentShare(opponentUserId, requestId, dto);
  }

  /**
   * Host starts the match once opponent is ready and funded.
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

    const matchRef = `MATCH_${Date.now()}_${randomBytes(4).toString('hex').toUpperCase()}`;

    const updated = await this.prisma.versusRequest.update({
      where: { id: requestId },
      data: {
        status: 'STARTED',
        startedAt: now,
        matchReference: matchRef,
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

  /**
   * Either participant cancels the match before start. Triggers refunds.
   */
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

    if (request.status === 'STARTED') {
      throw new BadRequestException('Cannot cancel a match that has already started');
    }

    if (request.status === 'CANCELLED' || request.status === 'DECLINED' || request.status === 'EXPIRED') {
      return request;
    }

    const { request: updated } = await this.refundEscrow(requestId, 'CANCELLED');
    return updated;
  }

  /**
   * Opponent declines challenge before funding. Triggers host refund.
   */
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

  /**
   * Toggle opponent readiness (requires opponent to be funded).
   */
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

  /**
   * Get single request detail with on-read passive expiry check.
   */
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

  /**
   * Get active and pending requests for user with on-read expiry sweep.
   */
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

  /**
   * Sweep and refund all expired pending requests (used by cron job).
   */
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
}
