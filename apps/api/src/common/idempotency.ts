import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import type { Request, Response } from 'express';
import { DomainError } from './errors';
import type { Principal } from './principal';
import { Tenancy } from './services';

const MAX_STORED = 256_000;

/**
 * Idempotency-Key for staff and patient writes. The first request with a key reserves it for that caller and stores
 * the response on success; a retry with the same key and the same request replays the stored response instead of
 * repeating the action (lost responses, double taps, the console's offline queue). The same key with a different
 * request is refused, and a retry while the first is still running gets 409. Failures release the key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly tenancy: Tenancy) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const raw = req.headers['idempotency-key'];
    const key = typeof raw === 'string' ? raw.trim() : '';
    const p = req.principal;
    if (!key || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !p || (p.kind !== 'staff' && p.kind !== 'patient')) return next.handle();
    if (key.length > 100) throw new DomainError('idempotency_key_too_long', HttpStatus.BAD_REQUEST);
    const actor = p.kind === 'staff' ? p.userId : p.accountId;
    const hash = createHash('sha256').update(`${req.method} ${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`).digest('hex');
    const orgId = p.orgId;

    return from(this.reserve(orgId, actor, key, hash)).pipe(
      mergeMap((r) => {
        if (r.replay) {
          res.status(r.status).setHeader('idempotent-replayed', 'true');
          return of(r.body);
        }
        return next.handle().pipe(
          mergeMap((body) => from(this.store(orgId, actor, key, res.statusCode, body).then(() => body))),
          catchError((e) => from(this.release(orgId, actor, key)).pipe(mergeMap(() => throwError(() => e)))),
        );
      }),
    );
  }

  private reserve(orgId: string, actor: string, key: string, hash: string): Promise<{ replay: false } | { replay: true; status: number; body: unknown }> {
    return this.tenancy.system(orgId, async (tx) => {
      const ins = await tx.maybeOne(
        `insert into idempotency_responses (organisation_id, actor_id, key, request_hash) values (app_org(), $1, $2, $3)
         on conflict (organisation_id, actor_id, key) do nothing returning id`,
        [actor, key, hash],
      );
      if (ins) return { replay: false as const };
      const row = await tx.one<{ request_hash: string; state: string; status: number | null; body: unknown; stale: boolean; expired: boolean }>(
        `select request_hash, state, status, body, created_at < now() - interval '60 seconds' as stale, created_at < now() - interval '24 hours' as expired
         from idempotency_responses where actor_id = $1 and key = $2 for update`,
        [actor, key],
      );
      if (row.expired || (row.state === 'pending' && row.stale)) {
        // An old key, or a reservation whose request never finished: start again.
        await tx.query(`update idempotency_responses set request_hash = $3, state = 'pending', status = null, body = null, created_at = now() where actor_id = $1 and key = $2`, [actor, key, hash]);
        return { replay: false as const };
      }
      if (row.request_hash !== hash) throw new DomainError('idempotency_key_reused', HttpStatus.UNPROCESSABLE_ENTITY);
      if (row.state === 'pending') throw new DomainError('request_in_progress', HttpStatus.CONFLICT);
      return { replay: true as const, status: row.status ?? 200, body: row.body };
    });
  }

  private async store(orgId: string, actor: string, key: string, status: number, body: unknown) {
    const json = JSON.stringify(body ?? null);
    await this.tenancy.system(orgId, (tx) =>
      json.length > MAX_STORED
        ? tx.query('delete from idempotency_responses where actor_id = $1 and key = $2', [actor, key])
        : tx.query(`update idempotency_responses set state = 'done', status = $3, body = $4::jsonb where actor_id = $1 and key = $2`, [actor, key, status, json]),
    );
  }

  private async release(orgId: string, actor: string, key: string) {
    await this.tenancy.system(orgId, (tx) => tx.query(`delete from idempotency_responses where actor_id = $1 and key = $2 and state = 'pending'`, [actor, key])).catch(() => undefined);
  }
}
