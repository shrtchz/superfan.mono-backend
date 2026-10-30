import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { RedisService } from '../../mail/redis.service';

export const MAX_OTP_PER_HOUR = 3;
export const OTP_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour in ms
const OTP_RATE_WINDOW_SECONDS = 60 * 60; // 1 hour in seconds (for Redis TTL)

/**
 * Sliding-window rate limiter for OTP sends (Twilio or any SMS provider).
 * Allows at most MAX_OTP_PER_HOUR sends per phone number per rolling hour.
 *
 * Strategy (defence-in-depth, same pattern as AccountCreationRateLimiterService):
 *   1. In-memory sliding window — ultra-fast, no external dependency.
 *   2. Redis counter — shared across multiple server instances (optional; soft-fails when
 *      Redis is unavailable so the feature still works in development without Redis).
 */
@Injectable()
export class OtpRateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(OtpRateLimiterService.name);

  /** phone → sorted list of send timestamps (ms) within the current window */
  private readonly phoneTimestamps = new Map<string, number[]>();

  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(@Optional() private readonly redisService?: RedisService) {
    // Evict stale entries every 30 minutes to avoid unbounded memory growth.
    this.cleanupInterval = setInterval(() => this.cleanup(), 30 * 60 * 1000);
    this.cleanupInterval.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Checks whether the phone number has exceeded the hourly OTP send limit.
   * If within the limit, reserves a slot for the current request.
   *
   * @throws {HttpException} 429 Too Many Requests when the limit is exceeded.
   * @returns A rollback function to undo the reservation if the downstream send fails.
   */
  async checkAndReserve(phone: string): Promise<() => void> {
    const normalizedPhone = phone.trim();
    if (!normalizedPhone) {
      // Cannot rate-limit an empty phone — let the caller validate.
      return () => {};
    }

    const now = Date.now();
    const windowStart = now - OTP_RATE_WINDOW_MS;
    const redisKey = `ratelimit:otp_send:${normalizedPhone}`;

    // ── 1. In-memory sliding window ──────────────────────────────────────────
    const memTs = (this.phoneTimestamps.get(normalizedPhone) ?? []).filter(
      (ts) => ts > windowStart,
    );
    this.phoneTimestamps.set(normalizedPhone, memTs);
    const memCount = memTs.length;

    // ── 2. Redis counter (optional) ──────────────────────────────────────────
    let redisCount = 0;
    if (this.redisService) {
      try {
        const raw = await this.redisService.get(redisKey);
        redisCount = raw ? parseInt(raw, 10) || 0 : 0;
      } catch {
        // Soft-fail: Redis unavailable — fall back to in-memory count only.
      }
    }

    const totalCount = Math.max(memCount, redisCount);

    if (totalCount >= MAX_OTP_PER_HOUR) {
      this.logger.warn(
        `OTP rate limit exceeded: phone=${normalizedPhone} count=${totalCount} limit=${MAX_OTP_PER_HOUR}`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Too many verification codes requested. You can request at most ${MAX_OTP_PER_HOUR} codes per hour. Please try again later.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── Reserve slot ─────────────────────────────────────────────────────────
    memTs.push(now);
    this.phoneTimestamps.set(normalizedPhone, memTs);

    if (this.redisService) {
      // Overwrite counter with max observed value and reset TTL to 1 hour.
      this.redisService
        .set(redisKey, String(totalCount + 1), OTP_RATE_WINDOW_SECONDS)
        .catch(() => {});
    }

    // Return rollback in case the downstream Twilio/SMS call fails.
    return () => {
      const current = this.phoneTimestamps.get(normalizedPhone);
      if (current) {
        const idx = current.indexOf(now);
        if (idx !== -1) current.splice(idx, 1);
        if (current.length === 0) this.phoneTimestamps.delete(normalizedPhone);
      }
      if (this.redisService) {
        const rolledBack = Math.max(0, totalCount);
        if (rolledBack === 0) {
          this.redisService.del(redisKey).catch(() => {});
        } else {
          this.redisService
            .set(redisKey, String(rolledBack), OTP_RATE_WINDOW_SECONDS)
            .catch(() => {});
        }
      }
    };
  }

  private cleanup(): void {
    const windowStart = Date.now() - OTP_RATE_WINDOW_MS;
    for (const [phone, timestamps] of this.phoneTimestamps.entries()) {
      const valid = timestamps.filter((ts) => ts > windowStart);
      if (valid.length === 0) {
        this.phoneTimestamps.delete(phone);
      } else {
        this.phoneTimestamps.set(phone, valid);
      }
    }
  }
}
