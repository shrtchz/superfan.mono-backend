import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../config/database/prisma.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { NotificationService, NotificationTriggers } from '../notification/notification.service';
import { QuizService } from '../quiz/quiz.service';
import { VersusService } from './versus.service';

describe('Versus Notifications End-to-End', () => {
  let versusService: VersusService;
  let notificationService: NotificationService;
  let prismaMock: any;
  let gatewayMock: any;
  let quizMock: any;

  beforeEach(async () => {
    gatewayMock = {
      sendNotificationToUser: jest.fn().mockResolvedValue(true),
      sendVersusEvent: jest.fn(),
    };

    quizMock = {
      getVersusQuestionPack: jest.fn().mockResolvedValue({ quizzes: [] }),
    };

    const createdNotifications: any[] = [];

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
      notification: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          return (
            createdNotifications.find(
              (n) =>
                n.userId === where.userId &&
                (!where.type || n.type === where.type) &&
                (!where.message || n.message === where.message),
            ) || null
          );
        }),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const entry = { id: createdNotifications.length + 1, ...data, read: false, createdAt: new Date() };
          createdNotifications.push(entry);
          return entry;
        }),
      },
      $transaction: jest.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prismaMock);
        }
        return cb;
      }),
    };

    // Override global prisma export for NotificationService
    const prismaModule = require('../prisma/prisma');
    prismaModule.prisma = prismaMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VersusService,
        NotificationService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationGateway, useValue: gatewayMock },
        { provide: QuizService, useValue: quizMock },
      ],
    }).compile();

    versusService = module.get<VersusService>(VersusService);
    notificationService = module.get<NotificationService>(NotificationService);
  });

  describe('1. Backend Notification Templates (No Emojis)', () => {
    it('generates Live 1v1 request received message without emojis and with formatted jackpot', async () => {
      const notif = await notificationService.versusRequestSent(
        2,
        'alice',
        'Live 1v1',
        1000,
        101,
      );

      expect(notif).toBeDefined();
      expect(notif?.userId).toBe(2);
      expect(notif?.type).toBe(NotificationTriggers.VERSUS_REQUEST_SENT);
      expect(notif?.message).toBe(
        'New Versus request! alice challenged you to a Live 1v1 for a ₦1,000 jackpot. Tap to respond.',
      );
      // Ensure no leading emoji on backend
      expect(notif?.message.startsWith('⚔️')).toBe(false);
    });

    it('generates Schedule H2H request received message without emojis and mentions 48hrs', async () => {
      const notif = await notificationService.versusRequestSent(
        2,
        'alice',
        'SCHEDULE_H2H',
        5000,
        102,
      );

      expect(notif).toBeDefined();
      expect(notif?.userId).toBe(2);
      expect(notif?.type).toBe(NotificationTriggers.VERSUS_REQUEST_SENT);
      expect(notif?.message).toBe(
        'New Versus request! alice challenged you to a Schedule H2H for a ₦5,000 jackpot. It starts in 48hrs. Tap to respond.',
      );
      expect(notif?.message.startsWith('⚔️')).toBe(false);
    });

    it('generates request accepted message for the sender only without emojis', async () => {
      const notif = await notificationService.versusRequestAccepted(
        1,
        'bob',
        101,
      );

      expect(notif).toBeDefined();
      expect(notif?.userId).toBe(1);
      expect(notif?.type).toBe(NotificationTriggers.VERSUS_REQUEST_ACCEPTED);
      expect(notif?.message).toBe(
        "bob accepted your Versus request. Start the match when you're ready.",
      );
      expect(notif?.message.startsWith('✅')).toBe(false);
    });

    it('generates expiration messages for both participants with distinct copies', async () => {
      const res = await notificationService.versusRequestExpired(
        101,
        1,
        2,
        'alice',
        'bob',
        'Live 1v1',
      );

      expect(res.hostNotif?.userId).toBe(1);
      expect(res.hostNotif?.message).toBe(
        'Your Live 1v1 with bob expired because it was not started in time.',
      );
      expect(res.hostNotif?.message.startsWith('⏰')).toBe(false);

      expect(res.oppNotif?.userId).toBe(2);
      expect(res.oppNotif?.message).toBe(
        'The Live 1v1 request from alice expired.',
      );
      expect(res.oppNotif?.message.startsWith('⏰')).toBe(false);
    });

    it('generates win, draw, and loss result messages accurately', async () => {
      // HOST_WON
      const hostWonResults: any = await notificationService.versusMatchResult({
        id: 101,
        outcome: 'HOST_WON',
        hostId: 1,
        opponentId: 2,
        host: { username: 'alice' },
        opponent: { username: 'bob' },
        jackpot: 2000,
        payoutStatus: 'PAID',
      });

      expect(hostWonResults).toHaveLength(2);
      const [winnerNotif, loserNotif] = hostWonResults;

      expect(winnerNotif.userId).toBe(1);
      expect(winnerNotif.type).toBe(NotificationTriggers.VERSUS_MATCH_WIN);
      expect(winnerNotif.message).toBe(
        'You won ₦2,000 in your Versus against bob! It has been credited to your Savings Account.',
      );
      expect(winnerNotif.message.startsWith('🏆')).toBe(false);

      expect(loserNotif.userId).toBe(2);
      expect(loserNotif.type).toBe(NotificationTriggers.VERSUS_MATCH_LOSS);
      expect(loserNotif.message).toBe(
        'alice won this Versus. Want a rematch?',
      );

      // DRAW
      const drawResults: any = await notificationService.versusMatchResult({
        id: 102,
        outcome: 'DRAW',
        hostId: 1,
        opponentId: 2,
        host: { username: 'alice' },
        opponent: { username: 'bob' },
        jackpot: 2000,
        payoutStatus: 'REFUNDED',
      });

      expect(drawResults).toHaveLength(2);
      expect(drawResults[0].userId).toBe(1);
      expect(drawResults[0].type).toBe(NotificationTriggers.VERSUS_MATCH_DRAW);
      expect(drawResults[0].message).toBe("It's a draw! You and bob finished level.");
      expect(drawResults[0].message.startsWith('🤝')).toBe(false);

      expect(drawResults[1].userId).toBe(2);
      expect(drawResults[1].type).toBe(NotificationTriggers.VERSUS_MATCH_DRAW);
      expect(drawResults[1].message).toBe("It's a draw! You and alice finished level.");
    });
  });

  describe('2. Idempotency & Duplicate Prevention', () => {
    it('prevents duplicate notification for repeated event calls with identical idempotency key', async () => {
      const first = await notificationService.versusRequestSent(2, 'alice', 'Live 1v1', 1000, 201);
      expect(first).toBeDefined();

      const second = await notificationService.versusRequestSent(2, 'alice', 'Live 1v1', 1000, 201);
      // Returns null or existing without creating a second record
      expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    });

    it('does not send match result if outcome is missing or payout has not succeeded', async () => {
      const unfinalized = await notificationService.versusMatchResult({
        id: 301,
        outcome: '',
        hostId: 1,
        opponentId: 2,
        host: { username: 'alice' },
        opponent: { username: 'bob' },
        jackpot: 1000,
        payoutStatus: 'PENDING',
      });
      expect(unfinalized).toBeNull();

      const failedPayout = await notificationService.versusMatchResult({
        id: 302,
        outcome: 'HOST_WON',
        hostId: 1,
        opponentId: 2,
        host: { username: 'alice' },
        opponent: { username: 'bob' },
        jackpot: 1000,
        payoutStatus: 'FAILED',
      });
      expect(failedPayout).toBeNull();
    });
  });

  describe('3. VersusService Integration', () => {
    it('notifies opponent only upon successful request creation', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ id: 1, username: 'alice' });
      prismaMock.user.findFirst.mockResolvedValueOnce({ id: 2, username: 'bob' });
      prismaMock.wallet.findUnique.mockResolvedValueOnce({ userId: 1, savingsBalance: 1000 });
      prismaMock.versusRequest.create.mockResolvedValueOnce({
        id: 42,
        hostId: 1,
        opponentId: 2,
        mode: 'LIVE_1V1',
        jackpot: 1000,
        hostShare: 500,
        opponentShare: 500,
      });

      const spySent = jest.spyOn(notificationService, 'versusRequestSent');

      await versusService.createRequest(1, {
        opponent: 'bob',
        mode: 'Live 1v1',
        jackpot: 1000,
        hostShare: 500,
        opponentShare: 500,
        fundingAccount: 'savings',
      });

      expect(spySent).toHaveBeenCalledWith(2, 'alice', 'LIVE_1V1', 1000, 42);
      expect(spySent).not.toHaveBeenCalledWith(1, expect.anything(), expect.anything(), expect.anything(), expect.anything());
    });

    it('notifies host only upon opponent acceptance', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValueOnce({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60000),
        opponentShare: 500,
        opponentFunded: false,
        mode: 'LIVE_1V1',
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });
      prismaMock.wallet.findUnique.mockResolvedValueOnce({ userId: 2, savingsBalance: 1000 });
      prismaMock.versusRequest.update.mockResolvedValueOnce({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'ACCEPTED',
      });

      const spyAccepted = jest.spyOn(notificationService, 'versusRequestAccepted');

      await versusService.fundOpponentShare(2, 42, { fundingAccount: 'savings' });

      expect(spyAccepted).toHaveBeenCalledWith(1, 'bob', 42);
      expect(spyAccepted).not.toHaveBeenCalledWith(2, expect.anything(), expect.anything());
    });

    it('notifies both players when an unstarted request expires in refundEscrow', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValueOnce({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'PENDING',
        escrowStatus: 'HELD',
        hostShare: 500,
        opponentShare: 500,
        hostFundingAccount: 'savings',
        opponentFunded: false,
        mode: 'LIVE_1V1',
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });
      prismaMock.versusRequest.update.mockResolvedValueOnce({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'EXPIRED',
        escrowStatus: 'REFUNDED',
        mode: 'LIVE_1V1',
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      const spyExpired = jest.spyOn(notificationService, 'versusRequestExpired');

      await versusService.refundEscrow(42, 'EXPIRED');

      expect(spyExpired).toHaveBeenCalledWith(42, 1, 2, 'alice', 'bob', 'LIVE_1V1');
    });

    it('never expires or notifies an already started match', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValueOnce({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'IN_PROGRESS',
        escrowStatus: 'HELD',
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      const spyExpired = jest.spyOn(notificationService, 'versusRequestExpired');

      const res = await versusService.refundEscrow(42, 'EXPIRED');

      expect(res.refunded).toBe(false);
      expect(spyExpired).not.toHaveBeenCalled();
    });

    it('finalizes match and notifies winner and loser after settlement succeeds', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValueOnce({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'IN_PROGRESS',
        payoutStatus: 'PENDING',
        hostScore: 25,
        opponentScore: 18,
        hostTimeSeconds: 40,
        opponentTimeSeconds: 45,
        hostAccuracy: 85,
        opponentAccuracy: 70,
        hostStreak: 5,
        opponentStreak: 3,
        jackpot: 2000,
        mode: 'LIVE_1V1',
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });
      prismaMock.versusRequest.update.mockResolvedValueOnce({
        id: 42,
        hostId: 1,
        opponentId: 2,
        status: 'COMPLETED',
        outcome: 'HOST_WON',
        winnerId: 1,
        jackpotWon: 2000,
        jackpot: 2000,
        payoutStatus: 'PAID',
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      const spyResult = jest.spyOn(notificationService, 'versusMatchResult');

      await versusService.finalizeMatchAndPayout(42);

      expect(spyResult).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 42,
          outcome: 'HOST_WON',
          winnerId: 1,
          payoutStatus: 'PAID',
        }),
      );
    });
  });
});
