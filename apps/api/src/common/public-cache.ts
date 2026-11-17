import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { CONFIG, type Config } from '../config';
import type { Principal } from './principal';

export const CACHE_TTL_KEY = 'hf:cache_ttl';
/** Cache an anonymous public GET response for `seconds` (catalogue data only - never PHI). */
export const PublicCache = (seconds?: number) => SetMetadata(CACHE_TTL_KEY, seconds ?? -1);

/**
 * Short in-process cache for anonymous catalogue reads (NFR-2). Only requests by the `public` principal are cached:
 * signed-in patients and staff always hit the database. Keys include the organisation and the full URL.
 * Also sets Cache-Control so Vercel/CDN can cache the same responses.
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  /** orgId -> url -> entry, so a write can drop one organisation's entries. */
  private readonly store = new Map<string, Map<string, { at: number; ttl: number; body: unknown }>>();
  private size = 0;
  constructor(private readonly reflector: Reflector, @Inject(CONFIG) private readonly cfg: Config) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<number | undefined>(CACHE_TTL_KEY, ctx.getHandler());
    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // Any successful write (booking, payment webhook, catalogue edit, review moderation) invalidates this process's
      // entries for the organisation. Other replicas converge within the TTL; bookings stay safe because the
      // database exclusion constraint, not the cached slot list, decides whether a slot is free.
      const orgId = (req.principal as { orgId?: string } | undefined)?.orgId;
      return next.handle().pipe(tap(() => this.invalidate(orgId)));
    }
    if (meta === undefined || req.principal?.kind !== 'public' || this.cfg.PUBLIC_CACHE_SECONDS === 0) return next.handle();
    const ttl = meta === -1 ? this.cfg.PUBLIC_CACHE_SECONDS : Math.min(meta, this.cfg.PUBLIC_CACHE_SECONDS);
    const orgId = req.principal.orgId;
    const bucket = this.store.get(orgId);
    const hit = bucket?.get(req.originalUrl);
    res.setHeader('cache-control', `public, max-age=${ttl}`);
    if (hit && Date.now() - hit.at < hit.ttl * 1000) return of(hit.body);
    return next.handle().pipe(
      tap((body) => {
        if (this.size > 5000) this.invalidate(undefined);
        let b = this.store.get(orgId);
        if (!b) this.store.set(orgId, (b = new Map()));
        if (!b.has(req.originalUrl)) this.size++;
        b.set(req.originalUrl, { at: Date.now(), ttl, body });
      }),
    );
  }

  /** Drop one organisation's entries, or everything when the organisation is unknown (e.g. platform actions). */
  invalidate(orgId: string | undefined) {
    if (!orgId) {
      this.store.clear();
      this.size = 0;
      return;
    }
    this.size -= this.store.get(orgId)?.size ?? 0;
    this.store.delete(orgId);
  }
}
