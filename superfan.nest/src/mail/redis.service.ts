import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(RedisService.name);
  private lastSoftFailLogAt = 0;

  constructor() {
    if (process.env.REDIS_URL) {
      // Production
      this.redis = new Redis(process.env.REDIS_URL);
    } else {
      // Local development
      this.redis = new Redis({
        host: process.env.LOCAL_REDIS_HOST || '127.0.0.1',
        port: Number(process.env.LOCAL_REDIS_PORT) || 6379,
      });
    }

    this.redis.on('error', (err) => {
      console.error('Redis error occurred:', err);
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  getClient() {
    return this.redis;
  }

  private softFail<T>(operation: string, error: unknown, fallback: T): T {
    const now = Date.now();
    // Avoid log spam when Upstash quota is exhausted.
    if (now - this.lastSoftFailLogAt > 30_000) {
      this.lastSoftFailLogAt = now;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Redis ${operation} failed; continuing without cache. ${message}`,
      );
    }
    return fallback;
  }

  async get(key: string) {
    try {
      return await this.redis.get(key);
    } catch (error) {
      return this.softFail('get', error, null);
    }
  }

  async set(key: string, value: string, ttlSeconds?: number) {
    try {
      if (ttlSeconds) {
        await this.redis.set(key, value, 'EX', ttlSeconds);
        return;
      }
      await this.redis.set(key, value);
    } catch (error) {
      this.softFail('set', error, undefined);
    }
  }

  async del(key: string) {
    try {
      return await this.redis.del(key);
    } catch (error) {
      return this.softFail('del', error, 0);
    }
  }

  async exists(key: string) {
    try {
      return await this.redis.exists(key);
    } catch (error) {
      return this.softFail('exists', error, 0);
    }
  }

  async expire(key: string, seconds: number) {
    try {
      return await this.redis.expire(key, seconds);
    } catch (error) {
      return this.softFail('expire', error, 0);
    }
  }

  async lpush(key: string, value: string) {
    try {
      return await this.redis.lpush(key, value);
    } catch (error) {
      return this.softFail('lpush', error, 0);
    }
  }

  async lrange(key: string, start: number, stop: number) {
    try {
      return await this.redis.lrange(key, start, stop);
    } catch (error) {
      return this.softFail('lrange', error, [] as string[]);
    }
  }

  async ltrim(key: string, start: number, stop: number) {
    try {
      return await this.redis.ltrim(key, start, stop);
    } catch (error) {
      return this.softFail('ltrim', error, 'OK');
    }
  }

  async publish(channel: string, message: string) {
    try {
      return await this.redis.publish(channel, message);
    } catch (error) {
      return this.softFail('publish', error, 0);
    }
  }
}
