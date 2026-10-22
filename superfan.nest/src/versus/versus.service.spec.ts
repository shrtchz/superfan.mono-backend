import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../config/database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { determineVersusWinner, VersusService } from './versus.service';

describe('VersusService', () => {
  let service: VersusService;
  let prismaMock: any;
  let notificationMock: any;
  let gatewayMock: any;

  beforeEach(async () => {
    notificationMock = {
      versusRequestSent: jest.fn().mockResolvedValue({}),
      versusRequestAccepted: jest.fn().mockResolvedValue({}),
      versusRequestDeclined: jest.fn().mockResolvedValue({}),
      versusRequestExpired: jest.fn().mockResolvedValue({}),
    };

    gatewayMock = {
      sendVersusEvent: jest.fn(),
    };

    prismaMock = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      wallet: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      walletTransaction: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        create: jest.fn(),
      },
      versusRequest: {
        count: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      ongoingQuiz: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prismaMock);
        }
        return cb;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VersusService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationService, useValue: notificationMock },
        { provide: NotificationGateway, useValue: gatewayMock },
      ],
    }).compile();

    service = module.get<VersusService>(VersusService);
  });

  describe('createRequest', () => {
    it('prevents self-challenges', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        username: 'alice',
      });

      await expect(
        service.createRequest(1, {
          opponent: '@alice',
          mode: 'Live 1v1',
          jackpot: 1000,
          hostShare: 500,
          opponentShare: 500,
          fundingAccount: 'savings',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if opponent does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        username: 'alice',
      });
      prismaMock.user.findFirst.mockResolvedValue(null);

      await expect(
        service.createRequest(1, {
          opponent: 'bob',
          mode: 'Live 1v1',
          jackpot: 1000,
          hostShare: 500,
          opponentShare: 500,
          fundingAccount: 'savings',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects if contribution split does not equal jackpot', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        username: 'alice',
      });
      prismaMock.user.findFirst.mockResolvedValue({
        id: 2,
        username: 'bob',
        isBanned: false,
      });

      await expect(
        service.createRequest(1, {
          opponent: 'bob',
          mode: 'Live 1v1',
          jackpot: 1000,
          hostShare: 400,
          opponentShare: 500,
          fundingAccount: 'savings',
        }),
      ).rejects.toThrow('must sum exactly to jackpot');
    });

    it('rejects if selected Savings account has insufficient balance (no combining)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        username: 'alice',
      });
      prismaMock.user.findFirst.mockResolvedValue({
        id: 2,
        username: 'bob',
        isBanned: false,
      });
      prismaMock.wallet.findUnique.mockResolvedValue({
        userId: 1,
        savingsBalance: 200,
          checkingBalance: 5000,
      });

      await expect(
        service.createRequest(1, {
          opponent: 'bob',
          mode: 'Live 1v1',
          jackpot: 1000,
          hostShare: 500,
          opponentShare: 500,
          fundingAccount: 'savings',
        }),
      ).rejects.toThrow('Insufficient Savings balance');
    });

    it('successfully debits host account, persists escrow transaction, and sends notification', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        username: 'alice',
      });
      prismaMock.user.findFirst.mockResolvedValue({
        id: 2,
        username: 'bob',
        isBanned: false,
      });
      prismaMock.wallet.findUnique.mockResolvedValue({
        userId: 1,
        savingsBalance: 1000,
          checkingBalance: 500,
      });
      prismaMock.versusRequest.create.mockImplementation(({ data }: any) => ({
        id: 42,
        ...data,
      }));

      const result = await service.createRequest(1, {
        opponent: 'bob',
        mode: 'Live 1v1',
        jackpot: 1000,
        hostShare: 600,
        opponentShare: 400,
        fundingAccount: 'savings',
      });

      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          data: expect.objectContaining({
            savingsBalance: { decrement: 600 },
          }),
        }),
      );

      expect(prismaMock.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 1,
            amount: 600,
            type: 'debit',
            status: 'HELD',
            account_type: 'savings',
            transactionType: 'VERSUS_ESCROW_DEBIT',
          }),
        }),
      );

      expect(gatewayMock.sendVersusEvent).toHaveBeenCalledWith(
        [1, 2],
        'versus:updated',
        expect.anything(),
      );

      expect(result.id).toBe(42);
    });
  });

  describe('startRequest', () => {
    it('rejects if caller is not the host', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60000),
      });

      await expect(service.startRequest(2, 42)).rejects.toThrow(ForbiddenException);
    });

    it('rejects if opponent is not ready or not funded', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60000),
        hostReady: true,
        opponentReady: false,
        opponentFunded: false,
      });

      await expect(service.startRequest(1, 42)).rejects.toThrow(
        'Cannot start: opponent has not funded or is not ready',
      );
    });

    it('starts match when opponent is ready and funded, broadcasting versus:started', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() + 60000),
        hostReady: true,
        opponentReady: true,
        opponentFunded: true,
      });
      prismaMock.versusRequest.update.mockResolvedValue({
        id: 42,
        status: 'STARTED',
        matchReference: 'MATCH_12345',
      });

      const res = await service.startRequest(1, 42);

      expect(prismaMock.versusRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 42 },
          data: expect.objectContaining({
            status: 'STARTED',
            matchReference: expect.stringContaining('MATCH_'),
          }),
        }),
      );

      expect(gatewayMock.sendVersusEvent).toHaveBeenCalledWith(
        [1, 2],
        'versus:started',
        expect.anything(),
      );
    });
  });

  describe('fundOpponentShare', () => {
    it('debits opponent account and marks opponentFunded and opponentReady', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        opponentShare: 400,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60000),
        opponentFunded: false,
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });
      prismaMock.wallet.findUnique.mockResolvedValue({
        userId: 2,
        checkingBalance: 1000,
          savingsBalance: 100,
      });
      prismaMock.versusRequest.update.mockResolvedValue({
        id: 42,
        opponentFunded: true,
        opponentReady: true,
        status: 'ACCEPTED',
      });

      const res = await service.fundOpponentShare(2, 42, { fundingAccount: 'checking' });

      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 2 },
          data: expect.objectContaining({
            checkingBalance: { decrement: 400 },
          }),
        }),
      );

      expect(prismaMock.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 2,
            amount: 400,
            type: 'debit',
            account_type: 'checking',
          }),
        }),
      );

      expect(gatewayMock.sendVersusEvent).toHaveBeenCalledWith(
        [1, 2],
        'versus:updated',
        expect.anything(),
      );
    });
  });

  describe('cancelRequest', () => {
    it('allows either host or opponent to cancel unstarted match and refunds escrows', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        hostShare: 600,
        hostFundingAccount: 'savings',
        opponentShare: 400,
        opponentFundingAccount: 'checking',
        opponentFunded: true,
        status: 'PENDING',
        escrowStatus: 'HELD',
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      prismaMock.versusRequest.update.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'CANCELLED',
      });

      // Opponent cancels
      await service.cancelRequest(2, 42);

      // Verified host refunded
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          data: expect.objectContaining({
            savingsBalance: { increment: 600 },
          }),
        }),
      );

      // Verified opponent refunded
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 2 },
          data: expect.objectContaining({
            checkingBalance: { increment: 400 },
          }),
        }),
      );

      expect(gatewayMock.sendVersusEvent).toHaveBeenCalledWith(
        [1, 2],
        'versus:updated',
        expect.anything(),
      );
    });

    it('rejects cancellation after match has started', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'STARTED',
      });

      await expect(service.cancelRequest(1, 42)).rejects.toThrow(
        'Cannot cancel a match that has already started',
      );
    });
  });

  describe('toggleReady', () => {
    it('disallows opponent marking ready if not funded', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        opponentFunded: false,
      });

      await expect(service.toggleReady(2, 42, { ready: true })).rejects.toThrow(
        'You must fund your contribution before marking ready',
      );
    });
  });

  describe('determineVersusWinner', () => {
    it('Rule 1: Highest score wins', () => {
      const resHost = determineVersusWinner(
        { score: 25, timeSeconds: 60, accuracy: 80, streak: 2 },
        { score: 20, timeSeconds: 30, accuracy: 90, streak: 5 },
      );
      expect(resHost.outcome).toBe('HOST_WON');

      const resOpp = determineVersusWinner(
        { score: 18, timeSeconds: 40, accuracy: 70, streak: 3 },
        { score: 22, timeSeconds: 50, accuracy: 65, streak: 1 },
      );
      expect(resOpp.outcome).toBe('OPPONENT_WON');
    });

    it('Rule 2: Tied score -> fastest completion time wins', () => {
      const resHost = determineVersusWinner(
        { score: 25, timeSeconds: 45.2, accuracy: 80, streak: 1 },
        { score: 25, timeSeconds: 50.8, accuracy: 95, streak: 10 },
      );
      expect(resHost.outcome).toBe('HOST_WON');

      const resOpp = determineVersusWinner(
        { score: 25, timeSeconds: 55.0, accuracy: 95, streak: 5 },
        { score: 25, timeSeconds: 40.5, accuracy: 80, streak: 1 },
      );
      expect(resOpp.outcome).toBe('OPPONENT_WON');
    });

    it('Rule 3: Tied score and time -> highest accuracy wins', () => {
      const resHost = determineVersusWinner(
        { score: 25, timeSeconds: 45.0, accuracy: 92.5, streak: 0 },
        { score: 25, timeSeconds: 45.0, accuracy: 88.0, streak: 8 },
      );
      expect(resHost.outcome).toBe('HOST_WON');

      const resOpp = determineVersusWinner(
        { score: 25, timeSeconds: 45.0, accuracy: 85.0, streak: 5 },
        { score: 25, timeSeconds: 45.0, accuracy: 90.0, streak: 1 },
      );
      expect(resOpp.outcome).toBe('OPPONENT_WON');
    });

    it('Rule 4: Tied score, time, accuracy -> DRAW (streak is NOT a tie-breaker)', () => {
      const resDraw = determineVersusWinner(
        { score: 25, timeSeconds: 45.0, accuracy: 90.0, streak: 1 },
        { score: 25, timeSeconds: 45.0, accuracy: 90.0, streak: 10 },
      );
      expect(resDraw.outcome).toBe('DRAW');
    });
  });

  describe('submitResult and finalizeMatchAndPayout', () => {
    it('rejects submission by non-participant', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 99,
        hostId: 1,
        opponentId: 2,
        status: 'STARTED',
      });

      await expect(
        service.submitResult(3, 99, {
          score: 20,
          timeSeconds: 30,
          accuracy: 80,
          streak: 2,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('prevents score modification if participant has already locked score (idempotent)', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 99,
        hostId: 1,
        opponentId: 2,
        status: 'STARTED',
        hostCompletedAt: new Date(),
        hostScore: 20,
        hostTimeSeconds: 30,
        hostAccuracy: 80,
        hostStreak: 2,
        opponentCompletedAt: null,
      });

      const res = await service.submitResult(1, 99, {
        score: 25,
        timeSeconds: 20,
        accuracy: 90,
        streak: 3,
      });

      expect(prismaMock.versusRequest.update).not.toHaveBeenCalled();
      expect(res.hostScore).toBe(20);
    });

    it('credits full jackpot to winner Savings ONLY on HOST_WON', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 99,
        hostId: 1,
        opponentId: 2,
        jackpot: 2000,
        hostShare: 1000,
        opponentShare: 1000,
        hostFundingAccount: 'savings',
        opponentFundingAccount: 'checking',
        status: 'STARTED',
        payoutStatus: 'PENDING',
        hostScore: 25,
        hostTimeSeconds: 40,
        hostAccuracy: 90,
        hostStreak: 3,
        opponentScore: 20,
        opponentTimeSeconds: 50,
        opponentAccuracy: 80,
        opponentStreak: 1,
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      prismaMock.versusRequest.update.mockResolvedValue({
        id: 99,
        status: 'COMPLETED',
        outcome: 'HOST_WON',
        winnerId: 1,
        jackpotWon: 2000,
        payoutStatus: 'PAID',
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      await service.finalizeMatchAndPayout(99);

      // Verify winner (host userId: 1) Savings Account is credited
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          data: expect.objectContaining({
            savingsBalance: { increment: 2000 },
          }),
        }),
      );

      // Verify ledger transaction created with account_type savings
      expect(prismaMock.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 1,
            amount: 2000,
            account_type: 'savings',
            transactionType: 'VERSUS_JACKPOT_PAYOUT',
          }),
        }),
      );
    });

    it('refunds stakes to original source accounts on DRAW', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 99,
        hostId: 1,
        opponentId: 2,
        jackpot: 2000,
        hostShare: 1200,
        opponentShare: 800,
        hostFundingAccount: 'savings',
        opponentFundingAccount: 'checking',
        status: 'STARTED',
        payoutStatus: 'PENDING',
        hostScore: 20,
        hostTimeSeconds: 40,
        hostAccuracy: 80,
        hostStreak: 1,
        opponentScore: 20,
        opponentTimeSeconds: 40,
        opponentAccuracy: 80,
        opponentStreak: 5,
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      prismaMock.versusRequest.update.mockResolvedValue({
        id: 99,
        status: 'COMPLETED',
        outcome: 'DRAW',
        winnerId: null,
        jackpotWon: 0,
        payoutStatus: 'REFUNDED',
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      await service.finalizeMatchAndPayout(99);

      // Host refunded to Savings
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          data: expect.objectContaining({
            savingsBalance: { increment: 1200 },
          }),
        }),
      );

      // Opponent refunded to Checking
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 2 },
          data: expect.objectContaining({
            checkingBalance: { increment: 800 },
          }),
        }),
      );

      // Immutable refund transactions
      expect(prismaMock.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 1,
            amount: 1200,
            account_type: 'savings',
            transactionType: 'VERSUS_DRAW_REFUND',
          }),
        }),
      );

      expect(prismaMock.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 2,
            amount: 800,
            account_type: 'checking',
            transactionType: 'VERSUS_DRAW_REFUND',
          }),
        }),
      );
    });

    it('is idempotent and skips payout/refund if already settled', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 99,
        hostId: 1,
        opponentId: 2,
        status: 'COMPLETED',
        payoutStatus: 'PAID',
      });

      await service.finalizeMatchAndPayout(99);

      expect(prismaMock.wallet.update).not.toHaveBeenCalled();
      expect(prismaMock.walletTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('getMatchResult masking', () => {
    it('masks opponent metrics as null when opponent has not finished', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 101,
        hostId: 1,
        opponentId: 2,
        status: 'STARTED',
        hostScore: 25,
        hostTimeSeconds: 40,
        hostAccuracy: 90,
        hostStreak: 2,
        hostCompletedAt: new Date(),
        opponentScore: 15,
        opponentTimeSeconds: 60,
        opponentAccuracy: 70,
        opponentStreak: 1,
        opponentCompletedAt: null,
      });

      const result = await service.getMatchResult(1, 101);
      expect(result.hostScore).toBe(25);
      expect(result.opponentScore).toBeNull();
      expect(result.opponentTimeSeconds).toBeNull();
      expect(result.opponentAccuracy).toBeNull();
      expect(result.opponentStreak).toBeNull();
    });
  });

  describe('get30DaysSummary', () => {
    it('aggregates W/D/L strictly for completed matches in the last 30 days', async () => {
      prismaMock.versusRequest.findMany.mockResolvedValue([
        { winnerId: 1, outcome: 'HOST_WON' },
        { winnerId: 2, outcome: 'OPPONENT_WON' },
        { winnerId: null, outcome: 'DRAW' },
        { winnerId: 1, outcome: 'OPPONENT_WON' }, // User 1 won as opponent
      ]);

      const summary = await service.get30DaysSummary(1);
      expect(summary.wins).toBe(2);
      expect(summary.draws).toBe(1);
      expect(summary.losses).toBe(1);

      expect(prismaMock.versusRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'COMPLETED',
            OR: [{ hostId: 1 }, { opponentId: 1 }],
          }),
        }),
      );
    });
  });

  describe('getHeadToHeadSummary', () => {
    it('computes H2H stats, personal best, and cash won from confirmed payouts only', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 2,
        username: 'bob',
      });

      prismaMock.versusRequest.findMany.mockResolvedValue([
        // Match 1: Most recent win (Score 26, confirmed payout 1500)
        {
          id: 10,
          hostId: 1,
          opponentId: 2,
          winnerId: 1,
          outcome: 'HOST_WON',
          hostScore: 26,
          jackpotWon: 1500,
          payoutStatus: 'PAID',
        },
        // Match 2: Loss (Score 20)
        {
          id: 9,
          hostId: 2,
          opponentId: 1,
          winnerId: 2,
          outcome: 'HOST_WON',
          opponentScore: 20,
          jackpotWon: 2000,
          payoutStatus: 'PAID',
        },
        // Match 3: Draw (Score 22, refund ignored for cash won)
        {
          id: 8,
          hostId: 1,
          opponentId: 2,
          winnerId: null,
          outcome: 'DRAW',
          hostScore: 22,
          jackpotWon: 0,
          payoutStatus: 'REFUNDED',
        },
      ]);

      const h2h = await service.getHeadToHeadSummary(1, 2);
      expect(h2h.wins).toBe(1);
      expect(h2h.losses).toBe(1);
      expect(h2h.draws).toBe(1);
      expect(h2h.cashWon).toBe(1500); // Only confirmed win jackpot, not opponent win or draw
      expect(h2h.personalBest).toBe(26);
      expect(h2h.isNewBest).toBe(true); // Latest match equaled personal best peak
    });
  });

  describe('getPaginatedVersusHistory and rematch derivation', () => {
    it('accurately derives rematch indicator based on earlier completed matches', async () => {
      prismaMock.versusRequest.count.mockResolvedValueOnce(2); // total matches
      prismaMock.versusRequest.findMany.mockResolvedValueOnce([
        {
          id: 20,
          hostId: 1,
          opponentId: 2,
          winnerId: 1,
          outcome: 'HOST_WON',
          mode: 'LIVE_1V1',
          createdAt: new Date('2026-10-21T12:00:00Z'),
          host: { id: 1, username: 'alice' },
          opponent: { id: 2, username: 'bob' },
        },
        {
          id: 15,
          hostId: 2,
          opponentId: 1,
          winnerId: 2,
          outcome: 'HOST_WON',
          mode: 'SCHEDULE_H2H',
          createdAt: new Date('2026-10-20T10:00:00Z'),
          host: { id: 2, username: 'bob' },
          opponent: { id: 1, username: 'alice' },
        },
      ]);

      // For Match 20: there was an earlier match (Match 15) -> count = 1
      prismaMock.versusRequest.count.mockResolvedValueOnce(1);
      // For Match 15: no earlier match -> count = 0
      prismaMock.versusRequest.count.mockResolvedValueOnce(0);

      const res = await service.getPaginatedVersusHistory(1, 1, 10);
      expect(res.total).toBe(2);
      expect(res.items.length).toBe(2);

      // Match 20 is a rematch
      expect(res.items[0].isRematch).toBe(true);
      expect(res.items[0].title).toBe('@bob 1v1 Rematch');

      // Match 15 is first match (not rematch)
      expect(res.items[1].isRematch).toBe(false);
      expect(res.items[1].title).toBe('@bob 1v1');
    });
  });

  describe('getAdminVersusSummary', () => {
    it('returns global summary where Live + Schedule === Total Versus and sums paid jackpots', async () => {
      prismaMock.versusRequest.count.mockResolvedValueOnce(15); // totalVersus
      prismaMock.versusRequest.count.mockResolvedValueOnce(6);  // totalScheduleH2H
      prismaMock.versusRequest.aggregate.mockResolvedValueOnce({
        _sum: { jackpotWon: 18500 },
      });

      const summary = await service.getAdminVersusSummary();
      expect(summary.totalVersus).toBe(15);
      expect(summary.totalScheduleH2H).toBe(6);
      expect(summary.totalLive1v1).toBe(9);
      expect(summary.totalLive1v1 + summary.totalScheduleH2H).toBe(summary.totalVersus);
      expect(summary.totalJackpotsWon).toBe(18500);
    });
  });

  describe('getAdminVersusLedger', () => {
    it('returns formatted paginated ledger rows with correct status and badges', async () => {
      // Setup total count and summary mocks
      prismaMock.versusRequest.count.mockResolvedValueOnce(3); // total records
      prismaMock.versusRequest.findMany.mockResolvedValueOnce([
        // 1. Completed win
        {
          id: 101,
          hostId: 1,
          opponentId: 2,
          status: 'COMPLETED',
          outcome: 'HOST_WON',
          winnerId: 1,
          mode: 'LIVE_1V1',
          questionsCount: 25,
          hostScore: 22,
          hostTimeSeconds: 79.2,
          hostAccuracy: 88,
          opponentScore: 18,
          opponentTimeSeconds: 95.0,
          opponentAccuracy: 72,
          language: 'Yoruba',
          subject: 'General',
          level: 'Basic',
          startedAt: new Date('2026-10-21T10:00:00Z'),
          settledAt: new Date('2026-10-21T10:05:00Z'),
          jackpotWon: 2000,
          payoutStatus: 'PAID',
          createdAt: new Date('2026-10-21T09:59:00Z'),
          host: { id: 1, username: 'alice' },
          opponent: { id: 2, username: 'bob' },
        },
        // 2. Completed draw with refund
        {
          id: 102,
          hostId: 1,
          opponentId: 2,
          status: 'COMPLETED',
          outcome: 'DRAW',
          winnerId: null,
          mode: 'SCHEDULE_H2H',
          questionsCount: 30,
          hostScore: 25,
          hostTimeSeconds: 110.0,
          hostAccuracy: 83.3,
          opponentScore: 25,
          opponentTimeSeconds: 110.0,
          opponentAccuracy: 83.3,
          language: 'Igbo',
          subject: 'History',
          level: 'Intermediate',
          startedAt: new Date('2026-10-20T10:00:00Z'),
          settledAt: new Date('2026-10-20T10:10:00Z'),
          jackpotWon: 0,
          payoutStatus: 'REFUNDED',
          createdAt: new Date('2026-10-20T09:50:00Z'),
          host: { id: 1, username: 'alice' },
          opponent: { id: 2, username: 'bob' },
        },
        // 3. Pending match (not finished)
        {
          id: 103,
          hostId: 1,
          opponentId: 3,
          status: 'STARTED',
          outcome: null,
          winnerId: null,
          mode: 'LIVE_1V1',
          questionsCount: 25,
          hostScore: 12,
          hostTimeSeconds: 40.0,
          hostAccuracy: 80,
          opponentScore: null,
          opponentTimeSeconds: null,
          opponentAccuracy: null,
          language: 'Yoruba',
          subject: 'General',
          level: 'Basic',
          startedAt: new Date('2026-10-21T11:00:00Z'),
          settledAt: null,
          jackpotWon: 0,
          payoutStatus: 'UNPAID',
          createdAt: new Date('2026-10-21T10:55:00Z'),
          host: { id: 1, username: 'alice' },
          opponent: { id: 3, username: 'charlie' },
        },
      ]);

      // Summary sub-call mocks
      prismaMock.versusRequest.count.mockResolvedValueOnce(3); // summary total
      prismaMock.versusRequest.count.mockResolvedValueOnce(1); // summary schedule
      prismaMock.versusRequest.aggregate.mockResolvedValueOnce({
        _sum: { jackpotWon: 2000 },
      });

      const res = await service.getAdminVersusLedger(1, 10);
      expect(res.total).toBe(3);
      expect(res.items.length).toBe(3);

      // Row 1 (Completed Win)
      const row1 = res.items[0];
      expect(row1.hostUsername).toBe('alice');
      expect(row1.guestUsername).toBe('bob');
      expect(row1.hostOutcome).toBe('W');
      expect(row1.guestOutcome).toBe('L');
      expect(row1.questionCount).toBe(25);
      expect(row1.hostStats).toBe('22/25 · 1:19 · 88%');
      expect(row1.guestStats).toBe('18/25 · 1:35 · 72%');
      expect(row1.mode).toBe('Live');
      expect(row1.versusStatus).toBe('Completed');
      expect(row1.jackpotPaymentStatus).toBe('Paid');
      expect(row1.jackpotWonAmount).toBe('NGN 2,000');

      // Row 2 (Completed Draw with Refund)
      const row2 = res.items[1];
      expect(row2.hostOutcome).toBe('D');
      expect(row2.guestOutcome).toBe('D');
      expect(row2.versusStatus).toBe('Completed');
      expect(row2.jackpotWonAmount).toBe('NGN 0');
      expect(row2.jackpotPaymentStatus).toBe('Refunded');
      expect(row2.mode).toBe('Schedule');

      // Row 3 (Pending)
      const row3 = res.items[2];
      expect(row3.hostOutcome).toBeNull();
      expect(row3.guestOutcome).toBeNull();
      expect(row3.guestStats).toBe('—');
      expect(row3.versusStatus).toBe('Pending');
      expect(row3.jackpotPaymentStatus).toBe('Unpaid');
      expect(row3.endDate).toBe('—');
    });
  });

  describe('getAdminPlayerQuestions', () => {
    it('returns answered questions for valid participant without per-question time', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValueOnce({
        id: 101,
        hostId: 1,
        opponentId: 2,
        hostAnswers: [
          {
            quizId: 'q-1',
            questionText: 'What is the capital of Lagos?',
            selectedAnswer: 'Ikeja',
            isCorrect: true,
          },
          {
            quizId: 'q-2',
            questionText: 'What is Yoruba word for Mother?',
            selectedAnswer: 'Baba',
            isCorrect: false,
            correctAnswer: 'Iya',
          },
        ],
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      const res = await service.getAdminPlayerQuestions(101, 1);
      expect(res.versusId).toBe(101);
      expect(res.playerId).toBe(1);
      expect(res.username).toBe('alice');
      expect(res.totalQuestions).toBe(2);
      expect(res.questions.length).toBe(2);

      // Question 1
      expect(res.questions[0].order).toBe(1);
      expect(res.questions[0].questionText).toBe('What is the capital of Lagos?');
      expect(res.questions[0].selectedAnswer).toBe('Ikeja');
      expect(res.questions[0].isCorrect).toBe(true);
      expect(res.questions[0].correctAnswer).toBeUndefined();
      expect((res.questions[0] as any).timeSeconds).toBeUndefined(); // No per-question time!

      // Question 2 (Wrong answer shows correctAnswer)
      expect(res.questions[1].order).toBe(2);
      expect(res.questions[1].selectedAnswer).toBe('Baba');
      expect(res.questions[1].isCorrect).toBe(false);
      expect(res.questions[1].correctAnswer).toBe('Iya');
    });

    it('throws ForbiddenException if player was not in the match', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValueOnce({
        id: 101,
        hostId: 1,
        opponentId: 2,
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      await expect(service.getAdminPlayerQuestions(101, 999)).rejects.toThrow(
        'Player 999 is not a participant in versus match 101',
      );
    });
  });
});
