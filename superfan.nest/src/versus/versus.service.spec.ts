import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../config/database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VersusService } from './versus.service';

describe('VersusService', () => {
  let service: VersusService;
  let prismaMock: any;
  let notificationMock: any;

  beforeEach(async () => {
    notificationMock = {
      versusRequestSent: jest.fn().mockResolvedValue({}),
      versusRequestAccepted: jest.fn().mockResolvedValue({}),
      versusRequestDeclined: jest.fn().mockResolvedValue({}),
      versusRequestExpired: jest.fn().mockResolvedValue({}),
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
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
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
          opponentShare: 500, // sums to 900, not 1000
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
        goldBalance: 200, // Needs 500
        personalBalance: 5000, // Checking has balance, but Savings was chosen!
      });

      await expect(
        service.createRequest(1, {
          opponent: 'bob',
          mode: 'Live 1v1',
          jackpot: 1000,
          hostShare: 500,
          opponentShare: 500,
          fundingAccount: 'savings', // Maps to goldBalance
        }),
      ).rejects.toThrow('Insufficient Savings balance');
    });

    it('rejects if selected Checking account has insufficient balance', async () => {
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
        goldBalance: 5000, // Savings has balance, but Checking was chosen!
        personalBalance: 100, // Needs 500
      });

      await expect(
        service.createRequest(1, {
          opponent: 'bob',
          mode: 'Live 1v1',
          jackpot: 1000,
          hostShare: 500,
          opponentShare: 500,
          fundingAccount: 'checking', // Maps to personalBalance
        }),
      ).rejects.toThrow('Insufficient Checking balance');
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
        goldBalance: 1000,
        personalBalance: 1500,
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

      // 1. Host goldBalance decremented
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          data: expect.objectContaining({
            goldBalance: { decrement: 600 },
          }),
        }),
      );

      // 2. Escrow WalletTransaction recorded
      expect(prismaMock.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 1,
            amount: 600,
            type: 'debit',
            status: 'HELD',
            account_type: 'gold',
            transactionType: 'VERSUS_ESCROW_DEBIT',
          }),
        }),
      );

      // 3. VersusRequest created with server-calculated ~60s expiry
      expect(prismaMock.versusRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hostId: 1,
            opponentId: 2,
            mode: 'LIVE_1V1',
            jackpot: 1000,
            hostShare: 600,
            opponentShare: 400,
            hostFundingAccount: 'gold',
            status: 'PENDING',
            escrowStatus: 'HELD',
          }),
        }),
      );

      // Verify server calculated expiry is approximately 60 seconds from now
      const createdExpiry = prismaMock.versusRequest.create.mock.calls[0][0].data.expiresAt;
      const diffMs = createdExpiry.getTime() - Date.now();
      expect(diffMs).toBeGreaterThan(55000);
      expect(diffMs).toBeLessThanOrEqual(60000);

      // 4. Notification dispatched to opponent
      expect(notificationMock.versusRequestSent).toHaveBeenCalledWith(
        2,
        'alice',
        'Live 1v1',
        1000,
      );

      expect(result.id).toBe(42);
    });

    it('calculates 48 hour expiry for Schedule H2H mode', async () => {
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
        goldBalance: 1000,
        personalBalance: 1500,
      });

      await service.createRequest(1, {
        opponent: 'bob',
        mode: 'Schedule H2H',
        jackpot: 2000,
        hostShare: 1000,
        opponentShare: 1000,
        fundingAccount: 'checking',
      });

      const createdExpiry = prismaMock.versusRequest.create.mock.calls[0][0].data.expiresAt;
      const diffHours = (createdExpiry.getTime() - Date.now()) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(47.9);
      expect(diffHours).toBeLessThanOrEqual(48.01);
    });
  });

  describe('refundEscrow', () => {
    it('refunds host wallet atomically and idempotently', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        hostShare: 600,
        hostFundingAccount: 'gold',
        status: 'PENDING',
        escrowStatus: 'HELD',
        opponent: { id: 2, username: 'bob' },
        host: { id: 1, username: 'alice' },
      });
      prismaMock.versusRequest.update.mockResolvedValue({
        id: 42,
        status: 'EXPIRED',
        escrowStatus: 'REFUNDED',
      });

      const result = await service.refundEscrow(42, 'EXPIRED');

      expect(result.refunded).toBe(true);
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          data: expect.objectContaining({
            goldBalance: { increment: 600 },
          }),
        }),
      );
      expect(prismaMock.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 1,
            amount: 600,
            type: 'credit',
            status: 'SUCCESS',
            account_type: 'gold',
            transactionType: 'VERSUS_ESCROW_REFUND',
          }),
        }),
      );
    });

    it('prevents double refund if already refunded (idempotency)', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        status: 'EXPIRED',
        escrowStatus: 'REFUNDED',
      });

      const result = await service.refundEscrow(42, 'EXPIRED');
      expect(result.refunded).toBe(false);
      expect(prismaMock.wallet.update).not.toHaveBeenCalled();
      expect(prismaMock.walletTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('acceptRequest', () => {
    it('allows opponent to fund their share using their chosen Vault account', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        hostShare: 600,
        opponentShare: 400,
        mode: 'LIVE_1V1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30000), // Valid, not expired
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });
      prismaMock.wallet.findUnique.mockResolvedValue({
        userId: 2,
        personalBalance: 1000,
        goldBalance: 50,
      });

      await service.acceptRequest(2, 42, { fundingAccount: 'checking' });

      // Opponent personalBalance decremented
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 2 },
          data: expect.objectContaining({
            personalBalance: { decrement: 400 },
          }),
        }),
      );

      // Opponent escrow debit logged
      expect(prismaMock.walletTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 2,
            amount: 400,
            type: 'debit',
            account_type: 'personal',
          }),
        }),
      );

      // Request updated to ACCEPTED
      expect(prismaMock.versusRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 42 },
          data: expect.objectContaining({
            status: 'ACCEPTED',
            opponentFundingAccount: 'personal',
          }),
        }),
      );

      // Host notified of acceptance
      expect(notificationMock.versusRequestAccepted).toHaveBeenCalledWith(
        1,
        'bob',
        'Live 1v1',
      );
    });

    it('rejects acceptance and auto-refunds host if request has expired', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        hostShare: 600,
        opponentShare: 400,
        hostFundingAccount: 'gold',
        status: 'PENDING',
        escrowStatus: 'HELD',
        expiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      await expect(
        service.acceptRequest(2, 42, { fundingAccount: 'checking' }),
      ).rejects.toThrow('This versus request has expired');

      // Verified that host escrow was refunded
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          data: expect.objectContaining({
            goldBalance: { increment: 600 },
          }),
        }),
      );
    });
  });

  describe('declineRequest', () => {
    it('declines request and triggers host refund', async () => {
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 42,
        hostId: 1,
        opponentId: 2,
        hostShare: 500,
        hostFundingAccount: 'gold',
        status: 'PENDING',
        escrowStatus: 'HELD',
        opponent: { id: 2, username: 'bob' },
        host: { id: 1, username: 'alice' },
      });

      await service.declineRequest(2, 42);

      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          data: expect.objectContaining({
            goldBalance: { increment: 500 },
          }),
        }),
      );

      expect(notificationMock.versusRequestDeclined).toHaveBeenCalledWith(
        1,
        'bob',
      );
    });
  });

  describe('sweepExpiredRequests', () => {
    it('sweeps pending requests where expiresAt <= now and refunds them', async () => {
      prismaMock.versusRequest.findMany.mockResolvedValue([
        {
          id: 101,
          hostId: 1,
          opponentId: 2,
          hostShare: 500,
          hostFundingAccount: 'gold',
          status: 'PENDING',
          escrowStatus: 'HELD',
          host: { id: 1, username: 'alice' },
          opponent: { id: 2, username: 'bob' },
        },
      ]);
      prismaMock.versusRequest.findUnique.mockResolvedValue({
        id: 101,
        hostId: 1,
        opponentId: 2,
        hostShare: 500,
        hostFundingAccount: 'gold',
        status: 'PENDING',
        escrowStatus: 'HELD',
        host: { id: 1, username: 'alice' },
        opponent: { id: 2, username: 'bob' },
      });

      const count = await service.sweepExpiredRequests();
      expect(count).toBe(1);
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          data: expect.objectContaining({
            goldBalance: { increment: 500 },
          }),
        }),
      );
    });
  });
});
