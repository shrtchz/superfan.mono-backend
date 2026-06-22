import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    if (process.env.REDIS_URL) {
      // Production
      this.redis = new Redis(process.env.REDIS_URL)
    } else {
      // Local development
      this.redis = new Redis({
        host: process.env.LOCAL_REDIS_HOST,
        port: Number(process.env.LOCAL_REDIS_PORT),
      })
    }
  }

  // async onModuleInit() {
  //   await this.redis.ping();
  //   console.log('Redis connected');
  // }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  getClient() {
    return this.redis;
  }


  async get(key: string) {
    return this.redis.get(key);
  }

  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ) {
    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
      return;
    }

    await this.redis.set(key, value);
  }

  async del(key: string) {
    return this.redis.del(key);
  }

  async exists(key: string) {
    return this.redis.exists(key);
  }

  async expire(key: string, seconds: number) {
    return this.redis.expire(key, seconds);
  }

  async lpush(key: string, value: string) {
    return this.redis.lpush(key, value);
  }

  async lrange(
    key: string,
    start: number,
    stop: number,
  ) {
    return this.redis.lrange(key, start, stop);
  }

  async ltrim(
    key: string,
    start: number,
    stop: number,
  ) {
    return this.redis.ltrim(key, start, stop);
  }

  async publish(
    channel: string,
    message: string,
  ) {
    return this.redis.publish(channel, message);
  }
}