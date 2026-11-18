import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor, OnModuleDestroy, OnModuleInit, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, mergeMap, of, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { CONFIG, type Config } from '../config';
import type { Principal } from './principal';

export const CACHE_TTL_KEY = 'hf:cache_ttl';
/** Cache an anonymous public GET response for `seconds` (catalogue data only - never PHI). */
export const PublicCache = (seconds?: number) => SetMetadata(CACHE_TTL_KEY, seconds ?? -1);

type Redis = import('ioredis').default;

/**
 * Short cache for anonymous catalogue reads (NFR-2). Only requests by the `public` principal are cached: signed-in
 * patients and staff always hit the database. Also sets Cache-Control so Vercel/CDN can cache the same responses.
 *
 * With REDIS_URL the cache is shared by every API replica and invalidated everywhere at once: keys embed a per-org
 * and a global version number, and any successful write bumps the version (one INCR) instead of deleting keys.
 * Without Redis, or while Redis is unreachable, an in-process cache keeps working for this replica.
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor, OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PublicCache');
  /** orgId -> url -> entry, so a write can drop one organisation's entries. */
  private readonly store = new Map<string, Map<string, { at: number; ttl: number; body: unknown }>>();
  private size = 0;
  private redis: Redis | null = null;
  private redisDownUntil = 0;
  constructor(private readonly reflector: Reflector, @Inject(CONFIG) private readonly cfg: Config) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<number | undefined>(CACHE_TTL_KEY, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // Any successful write (booking, payment webhook, catalogue edit, review moderation) invalidates the
      // organisation's entries. Bookings stay safe regardless: the database exclusion constraint, not the cached
      // slot list, decides whether a slot is free.
      const orgId = (req.principal as { orgId?: string } | undefined)?.orgId;
      return next.handle().pipe(mergeMap((body) => from(this.invalidate(orgId).then(() => body))));
    }
    if (meta === undefined || req.principal?.kind !== 'public' || this.cfg.PUBLIC_CACHE_SECONDS === 0) return next.handle();
    const ttl = meta === -1 ? this.cfg.PUBLIC_CACHE_SECONDS : Math.min(meta, this.cfg.PUBLIC_CACHE_SECONDS);
    const orgId = req.principal.orgId;
    res.setHeader('cache-control', `public, max-age=${ttl}`);
    return from(this.sharedGet(orgId, req.originalUrl)).pipe(
      mergeMap((shared) => {
        if (shared.hit) return of(shared.value);
        const local = this.store.get(orgId)?.get(req.originalUrl);
        if (!shared.key && local && Date.now() - local.at < local.ttl * 1000) return of(local.body);
        return next.handle().pipe(
          tap((body) => {
            if (shared.key) void this.sharedSet(shared.key, body, ttl);
            else this.localSet(orgId, req.originalUrl, body, ttl);
          }),
        );
      }),
    );
  }

  /** Drop one organisation's entries, or everything when the organisation is unknown (e.g. platform actions). */
  async invalidate(orgId: string | undefined) {
    if (!orgId) {
      this.store.clear();
      this.size = 0;
    } else {
      this.size -= this.store.get(orgId)?.size ?? 0;
      this.store.delete(orgId);
    }
    const r = await this.client();
    if (!r) return;
    try {
      await r.incr(orgId ? `pc:v:${orgId}` : 'pc:v:all');
    } catch (e) {
      this.down(e);
    }
  }

  /** Connect at startup (waiting up to 2 s) so the first reads already use the shared cache. */
  async onModuleInit() {
    if (!this.cfg.REDIS_URL) return;
    await this.client();
    const r = this.redis;
    if (r && r.status !== 'ready') await Promise.race([new Promise((ok) => r.once('ready', ok)), new Promise((ok) => setTimeout(ok, 2000))]);
  }

  async onModuleDestroy() {
    this.redis?.disconnect();
  }

  private localSet(orgId: string, url: string, body: unknown, ttl: number) {
    if (this.size > 5000) {
      this.store.clear();
      this.size = 0;
    }
    let b = this.store.get(orgId);
    if (!b) this.store.set(orgId, (b = new Map()));
    if (!b.has(url)) this.size++;
    b.set(url, { at: Date.now(), ttl, body });
  }

  /** Looks the URL up in Redis under the current versions; `key` is null when Redis is not in use. */
  private async sharedGet(orgId: string, url: string): Promise<{ hit: boolean; value?: unknown; key: string | null }> {
    const r = await this.client();
    if (!r) return { hit: false, key: null };
    try {
      const [all, org] = await r.mget('pc:v:all', `pc:v:${orgId}`);
      const key = `pc:${all ?? 0}:${orgId}:${org ?? 0}:${url}`;
      const raw = await r.get(key);
      return raw === null ? { hit: false, key } : { hit: true, value: JSON.parse(raw), key };
    } catch (e) {
      this.down(e);
      return { hit: false, key: null };
    }
  }

  private async sharedSet(key: string, body: unknown, ttl: number) {
    try {
      const json = JSON.stringify(body);
      if (json.length < 512_000) await this.redis?.set(key, json, 'EX', ttl);
    } catch (e) {
      this.down(e);
    }
  }

  private async client(): Promise<Redis | null> {
    if (!this.cfg.REDIS_URL || Date.now() < this.redisDownUntil) return null;
    if (!this.redis) {
      const R = (await import('ioredis')).default;
      this.redis = new R(this.cfg.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
      this.redis.on('error', () => undefined);
    }
    return this.redis.status === 'ready' ? this.redis : null;
  }

  /** After a Redis error, use the in-process cache for 30 seconds before trying Redis again. */
  private down(e: unknown) {
    this.redisDownUntil = Date.now() + 30_000;
    this.log.warn(`Redis unavailable for the public cache, using the in-process cache: ${(e as Error).message}`);
  }
}
