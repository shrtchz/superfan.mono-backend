import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../config/database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationGateway } from '../notification/notification.gateway';
import { VersusService } from './versus.service';

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
        goldBalance: 200,
        personalBalance: 5000,
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
        goldBalance: 1000,
        personalBalance: 500,
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
            goldBalance: { decrement: 600 },
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
            account_type: 'gold',
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
        personalBalance: 1000,
        goldBalance: 100,
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
            personalBalance: { decrement: 400 },
          }),
        }),
      );

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
        hostFundingAccount: 'gold',
        opponentShare: 400,
        opponentFundingAccount: 'personal',
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
            goldBalance: { increment: 600 },
          }),
        }),
      );

      // Verified opponent refunded
      expect(prismaMock.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 2 },
          data: expect.objectContaining({
            personalBalance: { increment: 400 },
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
});
