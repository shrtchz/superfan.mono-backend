import { HttpException, HttpStatus } from '@nestjs/common';
import {
  OtpRateLimiterService,
  MAX_OTP_PER_HOUR,
} from './otp-rate-limiter.service';

describe('OtpRateLimiterService', () => {
  let service: OtpRateLimiterService;

  beforeEach(() => {
    service = new OtpRateLimiterService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('checkAndReserve', () => {
    it('should allow up to 3 OTP requests for the same phone number in an hour', async () => {
      const phone = '+1234567890';

      for (let i = 0; i < MAX_OTP_PER_HOUR; i++) {
        const release = await service.checkAndReserve(phone);
        expect(typeof release).toBe('function');
      }
    });

    it('should reject the 4th OTP attempt with 429 Too Many Requests', async () => {
      const phone = '+1234567890';

      for (let i = 0; i < MAX_OTP_PER_HOUR; i++) {
        await service.checkAndReserve(phone);
      }

      await expect(service.checkAndReserve(phone)).rejects.toThrow(HttpException);

      try {
        await service.checkAndReserve(phone);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const response = httpErr.getResponse() as any;
        expect(response.message).toContain('at most 3 codes per hour');
      }
    });

    it('should allow an OTP send if slot is released after a failed delivery', async () => {
      const phone = '+1987654321';

      const releases: Array<() => void> = [];
      for (let i = 0; i < MAX_OTP_PER_HOUR; i++) {
        releases.push(await service.checkAndReserve(phone));
      }

      // 4th attempt fails
      await expect(service.checkAndReserve(phone)).rejects.toThrow(HttpException);

      // Rollback one failed send
      releases[0]();

      // Now 4th attempt succeeds
      const newRelease = await service.checkAndReserve(phone);
      expect(typeof newRelease).toBe('function');
    });

    it('should track different phone numbers independently', async () => {
      const phoneA = '+1111111111';
      const phoneB = '+2222222222';

      for (let i = 0; i < MAX_OTP_PER_HOUR; i++) {
        await service.checkAndReserve(phoneA);
      }

      // phoneA is blocked
      await expect(service.checkAndReserve(phoneA)).rejects.toThrow(HttpException);

      // phoneB can still receive OTPs
      const releaseB = await service.checkAndReserve(phoneB);
      expect(typeof releaseB).toBe('function');
    });

    it('should handle empty or whitespace phone without throwing error', async () => {
      const release = await service.checkAndReserve('   ');
      expect(typeof release).toBe('function');
    });
  });
});
