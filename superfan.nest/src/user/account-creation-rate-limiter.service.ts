import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
  OnModuleDestroy,
} from '@nestjs/common';
import { prisma } from '../prisma/prisma';
import { RedisService } from '../mail/redis.service';

export const MAX_ACCOUNT_CREATIONS_PER_IP = 5;
export const ACCOUNT_CREATION_WINDOW_MS = 24 * 60 * 60 * 1000; // rolling 24 hours

@Injectable()
export class AccountCreationRateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(AccountCreationRateLimiterService.name);
  // In-memory sliding window cache: ip -> array of creation timestamps
  private readonly ipCreations = new Map<string, number[]>();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(@Optional() private readonly redisService?: RedisService) {
    // Periodically evict entries older than 24h to avoid memory accumulation
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 30 * 60 * 1000);
    this.cleanupInterval.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  normalizeIp(rawIp?: string): string {
    if (!rawIp) return '';
    let ip = rawIp.trim();
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    return ip;
  }

  /**
   * Checks if an IP has exceeded the max 5 account creations per 24 hours.
   * If under the limit, reserves a slot and returns a release function to rollback on validation failure.
   */
  async checkAndReserve(rawIp?: string): Promise<() => void> {
    const ip = this.normalizeIp(rawIp);
    if (!ip) {
      // If IP cannot be determined, permit request
      return () => {};
    }

    const now = Date.now();
    const windowStart = now - ACCOUNT_CREATION_WINDOW_MS;

    // 1. In-memory sliding window count
    const memoryTimestamps = (this.ipCreations.get(ip) || []).filter(
      (ts) => ts > windowStart,
    );
    this.ipCreations.set(ip, memoryTimestamps);

    // 2. Database count (rolling 24h window)
    let dbCount = 0;
    try {
      dbCount = await prisma.user.count({
        where: {
          ip_address: ip,
          createdAt: {
            gte: new Date(windowStart),
          },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to query database for IP rate limit (${ip}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3. Redis count if available
    let redisCount = 0;
    const redisKey = `ratelimit:account_creation:${ip}`;
    if (this.redisService) {
      try {
        const raw = await this.redisService.get(redisKey);
        if (raw) {
          redisCount = parseInt(raw, 10) || 0;
        }
      } catch {
        // Soft fail handled by RedisService
      }
    }

    const totalCount = Math.max(memoryTimestamps.length, dbCount, redisCount);

    if (totalCount >= MAX_ACCOUNT_CREATIONS_PER_IP) {
      this.logger.warn(
        `Account creation blocked by IP rate limit: ip=${ip} count=${totalCount} limit=${MAX_ACCOUNT_CREATIONS_PER_IP}`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Too many accounts created from this IP address. Maximum ${MAX_ACCOUNT_CREATIONS_PER_IP} account creations allowed per 24-hour window. Please try again later.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Reserve attempt in memory
    memoryTimestamps.push(now);
    this.ipCreations.set(ip, memoryTimestamps);

    // Update Redis with 24h TTL (86400 seconds)
    if (this.redisService) {
      this.redisService
        .set(redisKey, String(totalCount + 1), 24 * 60 * 60)
        .catch(() => {});
    }

    // Return rollback function in case account creation fails downstream (e.g. invalid credentials)
    return () => {
      const current = this.ipCreations.get(ip);
      if (current) {
        const idx = current.indexOf(now);
        if (idx !== -1) {
          current.splice(idx, 1);
        }
        if (current.length === 0) {
          this.ipCreations.delete(ip);
        }
      }
      if (this.redisService) {
        const rolledBack = Math.max(0, totalCount);
        if (rolledBack === 0) {
          this.redisService.del(redisKey).catch(() => {});
        } else {
          this.redisService
            .set(redisKey, String(rolledBack), 24 * 60 * 60)
            .catch(() => {});
        }
      }
    };
  }

  private cleanup(): void {
    const windowStart = Date.now() - ACCOUNT_CREATION_WINDOW_MS;
    for (const [ip, timestamps] of this.ipCreations.entries()) {
      const valid = timestamps.filter((ts) => ts > windowStart);
      if (valid.length === 0) {
        this.ipCreations.delete(ip);
      } else {
        this.ipCreations.set(ip, valid);
      }
    }
  }
}
