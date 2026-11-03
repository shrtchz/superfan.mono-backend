import { HttpException, HttpStatus } from '@nestjs/common';
import {
  AccountCreationRateLimiterService,
  MAX_ACCOUNT_CREATIONS_PER_IP,
} from './account-creation-rate-limiter.service';
import { prisma } from '../prisma/prisma';

jest.mock('../prisma/prisma', () => ({
  prisma: {
    user: {
      count: jest.fn(),
    },
  },
}));

describe('AccountCreationRateLimiterService', () => {
  let service: AccountCreationRateLimiterService;

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.user.count as jest.Mock).mockResolvedValue(0);
    service = new AccountCreationRateLimiterService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('normalizeIp', () => {
    it('should return empty string for undefined or empty input', () => {
      expect(service.normalizeIp(undefined)).toBe('');
      expect(service.normalizeIp('')).toBe('');
      expect(service.normalizeIp('   ')).toBe('');
    });

    it('should strip IPv6 mapped IPv4 prefix', () => {
      expect(service.normalizeIp('::ffff:192.168.1.1')).toBe('192.168.1.1');
    });

    it('should trim surrounding whitespace', () => {
      expect(service.normalizeIp('  102.89.44.12  ')).toBe('102.89.44.12');
    });
  });

  describe('checkAndReserve', () => {
    it('should allow up to 5 reservations for the same IP', async () => {
      const ip = '197.210.55.10';

      for (let i = 0; i < MAX_ACCOUNT_CREATIONS_PER_IP; i++) {
        const release = await service.checkAndReserve(ip);
        expect(typeof release).toBe('function');
      }
    });

    it('should reject the 6th account creation attempt with 429 Too Many Requests', async () => {
      const ip = '197.210.55.10';

      for (let i = 0; i < MAX_ACCOUNT_CREATIONS_PER_IP; i++) {
        await service.checkAndReserve(ip);
      }

      await expect(service.checkAndReserve(ip)).rejects.toThrow(HttpException);

      try {
        await service.checkAndReserve(ip);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const response = httpErr.getResponse() as any;
        expect(response.message).toContain('Maximum 5 account creations allowed per 24-hour window');
      }
    });

    it('should allow account creation if IP is released after a failed attempt', async () => {
      const ip = '197.210.55.20';

      const releases: Array<() => void> = [];
      for (let i = 0; i < MAX_ACCOUNT_CREATIONS_PER_IP; i++) {
        releases.push(await service.checkAndReserve(ip));
      }

      // 6th attempt fails
      await expect(service.checkAndReserve(ip)).rejects.toThrow(HttpException);

      // Release one slot
      releases[0]();

      // Now 6th attempt succeeds
      const newRelease = await service.checkAndReserve(ip);
      expect(typeof newRelease).toBe('function');
    });

    it('should track different IPs independently', async () => {
      const ipA = '102.89.44.1';
      const ipB = '102.89.44.2';

      for (let i = 0; i < MAX_ACCOUNT_CREATIONS_PER_IP; i++) {
        await service.checkAndReserve(ipA);
      }

      // ipA is blocked
      await expect(service.checkAndReserve(ipA)).rejects.toThrow(HttpException);

      // ipB can still register
      const releaseB = await service.checkAndReserve(ipB);
      expect(typeof releaseB).toBe('function');
    });

    it('should respect database counts for existing accounts created in rolling 24h', async () => {
      const ip = '102.89.44.99';
      (prisma.user.count as jest.Mock).mockResolvedValue(5);

      await expect(service.checkAndReserve(ip)).rejects.toThrow(HttpException);
    });

    it('should allow request if IP cannot be extracted', async () => {
      const release = await service.checkAndReserve(undefined);
      expect(typeof release).toBe('function');
    });
  });
});
