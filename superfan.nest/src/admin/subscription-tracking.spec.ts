import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminService } from './admin.service';
import { UserService } from '../user/user.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ClerkService } from '../common/clerk/clerk.service';
import { MailService } from '../mail/mail.service';
import { TaskService } from '../tasks/tasks.service';
import { PointsConversionUtil } from '../common/utils/points-conversion.util';
import { prisma } from '../prisma/prisma';

// Mock dependencies
jest.mock('../prisma/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    subscription: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    walletTransaction: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    permission: { findMany: jest.fn() },
    subAdminInvite: { create: jest.fn(), findFirst: jest.fn() },
    subAdminPermission: { createMany: jest.fn() },
    role: { findFirst: jest.fn() },
    admin: { create: jest.fn() },
    subAdmin: { create: jest.fn(), findMany: jest.fn() },
  },
}));

describe('Subscription Visibility & Tracking Suite', () => {
  let adminService: AdminService;
  let userService: UserService;
  let analyticsService: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();

    const mailService = {} as MailService;
    const configService = { get: jest.fn() } as unknown as ConfigService;
    const clerkService = { getClient: jest.fn(), findByEmail: jest.fn() } as unknown as ClerkService;
    const taskService = {} as TaskService;
    const pointsConversionUtil = {} as PointsConversionUtil;

    adminService = new AdminService(
      mailService,
      configService,
      clerkService,
      taskService,
      pointsConversionUtil,
    );

    analyticsService = new AnalyticsService();

    userService = new UserService(
      clerkService,
      mailService,
      configService,
    );
  });

  describe('1. Client Management — Subscription Plan & Status Visibility', () => {
    it('should correctly format user with no subscription (Free tier, None status)', async () => {
      const mockUsers = [
        {
          id: 101,
          username: 'free_user',
          firstName: 'Alice',
          lastName: 'Free',
          email: 'alice@free.com',
          roleName: 'client',
          subscriptionPlan: 'FREE',
          active: true,
          isOnline: false,
          isBanned: false,
          createdAt: new Date('2026-01-01'),
        },
      ];

      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
        mockUsers,
        1, // total
        1, // activeCount
        0, // inactiveCount
        0, // bannedCount
      ]);
      (prisma.subscription.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await adminService.listClients({ page: 1, perPage: 10 });
      expect(result.data).toHaveLength(1);

      const client = result.data[0];
      expect(client.username).toBe('free_user');
      expect(client.subscription).toBe('Free');
      expect(client.plan).toBeNull();
      expect(client.subscriptionStatus).toBe('None');
      expect(client.subscriptionDate).toBeNull();
      expect(client.subscriptionExpiry).toBeNull();
    });

    it('should correctly format user with active Pro subscription', async () => {
      const now = new Date();
      const startDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
      const endDate = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000);

      const mockUsers = [
        {
          id: 102,
          username: 'pro_user',
          firstName: 'Bob',
          lastName: 'Pro',
          email: 'bob@pro.com',
          roleName: 'client',
          subscriptionPlan: 'PREMIUM_PRO',
          active: true,
          isOnline: true,
          isBanned: false,
          createdAt: new Date('2026-01-01'),
        },
      ];

      const mockSubscriptions = [
        {
          id: 1,
          userId: 102,
          subscriptionPlan: 'PREMIUM_PRO',
          status: 'ACTIVE',
          startDate,
          endDate,
          amount: 6000,
        },
      ];

      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
        mockUsers, 1, 1, 0, 0,
      ]);
      (prisma.subscription.findMany as jest.Mock).mockResolvedValueOnce(mockSubscriptions);

      const result = await adminService.listClients({ page: 1, perPage: 10 });
      const client = result.data[0];

      expect(client.username).toBe('pro_user');
      expect(client.subscription).toBe('Premium');
      expect(client.plan).toBe('Pro');
      expect(client.subscriptionStatus).toBe('Active');
      expect(client.subscriptionDate).toEqual(startDate);
      expect(client.subscriptionExpiry).toEqual(endDate);
    });

    it('should correctly format user with active Pro Max subscription', async () => {
      const now = new Date();
      const startDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const endDate = new Date(now.getTime() + 355 * 24 * 60 * 60 * 1000);

      const mockUsers = [
        {
          id: 103,
          username: 'promax_user',
          firstName: 'Charlie',
          lastName: 'Max',
          email: 'charlie@max.com',
          roleName: 'client',
          subscriptionPlan: 'PREMIUM_PRO_MAX',
          active: true,
          isOnline: true,
          isBanned: false,
          createdAt: new Date('2026-01-01'),
        },
      ];

      const mockSubscriptions = [
        {
          id: 2,
          userId: 103,
          subscriptionPlan: 'PREMIUM_PRO_MAX',
          status: 'ACTIVE',
          startDate,
          endDate,
          amount: 60000,
        },
      ];

      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
        mockUsers, 1, 1, 0, 0,
      ]);
      (prisma.subscription.findMany as jest.Mock).mockResolvedValueOnce(mockSubscriptions);

      const result = await adminService.listClients({ page: 1, perPage: 10 });
      const client = result.data[0];

      expect(client.subscription).toBe('Premium');
      expect(client.plan).toBe('Pro Max');
      expect(client.subscriptionStatus).toBe('Active');
    });

    it('should accurately detect expired subscriptions when endDate is in the past', async () => {
      const now = new Date();
      const pastStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const pastEnd = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

      const mockUsers = [
        {
          id: 104,
          username: 'expired_user',
          firstName: 'Dan',
          lastName: 'Old',
          email: 'dan@old.com',
          roleName: 'client',
          subscriptionPlan: 'PREMIUM_PRO',
          active: true,
          isOnline: false,
          isBanned: false,
          createdAt: new Date('2025-01-01'),
        },
      ];

      const mockSubscriptions = [
        {
          id: 3,
          userId: 104,
          subscriptionPlan: 'PREMIUM_PRO',
          status: 'ACTIVE', // raw status says active, but endDate is past
          startDate: pastStart,
          endDate: pastEnd,
          amount: 6000,
        },
      ];

      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
        mockUsers, 1, 1, 0, 0,
      ]);
      (prisma.subscription.findMany as jest.Mock).mockResolvedValueOnce(mockSubscriptions);

      const result = await adminService.listClients({ page: 1, perPage: 10 });
      const client = result.data[0];

      expect(client.subscriptionStatus).toBe('Expired');
      expect(client.subscription).toBe('Free');
      expect(client.plan).toBeNull();
      expect(client.subscriptionDate).toEqual(pastStart);
      expect(client.subscriptionExpiry).toEqual(pastEnd);
    });

    it('should accurately detect cancelled subscriptions', async () => {
      const mockUsers = [
        {
          id: 105,
          username: 'cancelled_user',
          firstName: 'Eve',
          lastName: 'Cancel',
          email: 'eve@cancel.com',
          roleName: 'client',
          subscriptionPlan: 'PREMIUM_PRO',
          active: true,
          isOnline: false,
          isBanned: false,
          createdAt: new Date('2026-01-01'),
        },
      ];

      const mockSubscriptions = [
        {
          id: 4,
          userId: 105,
          subscriptionPlan: 'PREMIUM_PRO',
          status: 'CANCELLED',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-02-01'),
          amount: 6000,
        },
      ];

      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
        mockUsers, 1, 1, 0, 0,
      ]);
      (prisma.subscription.findMany as jest.Mock).mockResolvedValueOnce(mockSubscriptions);

      const result = await adminService.listClients({ page: 1, perPage: 10 });
      const client = result.data[0];

      expect(client.subscriptionStatus).toBe('Cancelled');
      expect(client.subscription).toBe('Free');
      expect(client.plan).toBeNull();
    });

    it('should sweep and cancel expired unrenewed subscriptions', async () => {
      const expiredSub = {
        id: 99,
        userId: 200,
        status: 'ACTIVE',
        endDate: new Date(Date.now() - 10000),
      };
      (prisma.subscription.findMany as jest.Mock).mockResolvedValueOnce([expiredSub]);
      (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
        { id: 99, status: 'EXPIRED' },
        { id: 200, subscriptionPlan: 'FREE' },
      ]);

      const count = await userService.sweepExpiredSubscriptions();
      expect(count).toBe(1);
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 99 },
          data: { status: 'EXPIRED' },
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 200 },
          data: { subscriptionPlan: 'FREE' },
        }),
      );
    });
  });

  describe('2. Subscription Payment Visibility & Ledger', () => {
    it('should return subscription debits in wallet summary transactions list', async () => {
      const mockTransactions = [
        {
          id: 501,
          userId: 102,
          amount: 6000,
          type: 'debit',
          currency: 'NGN',
          payment_method: 'subscription',
          account_type: 'Checking',
          description: 'Pro Subscription Payment',
          status: 'SUCCESS',
          reference: 'SUB-PAY-12345-102',
          createdAt: new Date('2026-02-01T10:00:00Z'),
        },
        {
          id: 500,
          userId: 102,
          amount: 20000,
          type: 'credit',
          currency: 'NGN',
          payment_method: 'bank',
          account_type: 'Checking',
          description: 'Wallet Deposit',
          status: 'SUCCESS',
          reference: 'DEP-123',
          createdAt: new Date('2026-01-28T09:00:00Z'),
        },
      ];

      (prisma.walletTransaction.findMany as jest.Mock).mockResolvedValueOnce(mockTransactions);

      const summary = await analyticsService.getfullwalletSummaryPerClient(102);

      expect(summary.transactions).toBeDefined();
      expect(summary.transactions).toHaveLength(2);

      const subTx = summary.transactions[0];
      expect(subTx.id).toBe('501');
      expect(subTx.description).toBe('Pro Subscription Payment');
      expect(subTx.type).toBe('debit');
      expect(subTx.amount).toBe(6000);
      expect(subTx.payment_method).toBe('subscription');
      expect(subTx.status).toBe('SUCCESS');
    });
  });

  describe('3. Security & Read-Only Constraints', () => {
    it('should forbid administrators from manually creating or modifying user subscriptions', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 999,
        username: 'admin_user',
        roleName: 'superadmin',
      });

      await expect(
        userService.createSubscription(999, { subscriptionPlan: 'PREMIUM_PRO' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
