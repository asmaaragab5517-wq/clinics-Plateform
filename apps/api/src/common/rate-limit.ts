import { HttpException, HttpStatus, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { CONFIG, type Config } from '../config';

/**
 * Fixed-window rate limiter (SEC-5). Uses Redis when configured so limits hold across API instances,
 * otherwise an in-process map (development, tests).
 */
@Injectable()
export class RateLimiter implements OnModuleDestroy {
  private redis: import('ioredis').default | null = null;
  private readonly local = new Map<string, { n: number; reset: number }>();

  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  private async client() {
    if (!this.cfg.REDIS_URL) return null;
    if (!this.redis) {
      const Redis = (await import('ioredis')).default;
      this.redis = new Redis(this.cfg.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
      this.redis.on('error', () => undefined);
    }
    return this.redis;
  }

  /** Throws 429 when `key` exceeds `limit` hits in `windowSeconds`. Fails open if Redis is unavailable. */
  async hit(key: string, limit: number, windowSeconds: number) {
    const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
    let n: number;
    const r = await this.client();
    if (r) {
      try {
        n = await r.incr(bucket);
        if (n === 1) await r.expire(bucket, windowSeconds + 1);
      } catch {
        return;
      }
    } else {
      const now = Date.now();
      const cur = this.local.get(bucket);
      n = cur && cur.reset > now ? cur.n + 1 : 1;
      this.local.set(bucket, { n, reset: now + windowSeconds * 1000 });
      if (this.local.size > 50_000) for (const [k, v] of this.local) if (v.reset < now) this.local.delete(k);
    }
    if (n > limit) throw new HttpException({ error: 'rate_limited', retryAfterSeconds: windowSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }
}
