import { Inject, Injectable } from '@nestjs/common';
import { Database, SecretBox, devKey, type TenantContext, type Tx } from '@hf/db';
import { CONFIG, type Config } from '../config';
import { tenantOf, type Principal, type RequestMeta } from './principal';

export const DB = Symbol('DB');
export const BOX = Symbol('BOX');

export function dbProviders() {
  return [
    { provide: DB, inject: [CONFIG], useFactory: (c: Config) => new Database(c.DATABASE_URL) },
    {
      provide: BOX,
      inject: [CONFIG],
      useFactory: (c: Config) => new SecretBox(c.FIELD_ENCRYPTION_KEY ?? devKey()),
    },
  ];
}

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  patientId?: string | null;
  clinicId?: string | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
}

/** Tamper-evident audit trail (FR-PRV-3). Always written inside the caller's transaction. */
@Injectable()
export class AuditService {
  async record(tx: Tx, p: Principal | null, meta: RequestMeta | null, e: AuditEntry) {
    const support = p?.kind === 'staff' ? p.support : null;
    const actorType = support ? 'support' : p?.kind === 'apikey' ? 'api_key' : (p?.kind ?? 'system');
    const actorId = p?.kind === 'staff' ? p.userId : p?.kind === 'patient' ? p.accountId : p?.kind === 'apikey' ? p.keyId : p?.kind === 'platform' ? p.adminId : null;
    const role = support ? `support:${support.accessId}` : p?.kind === 'staff' ? p.roles.join(',') : (p?.kind ?? 'system');
    await tx.query(`select audit_append($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [
      actorType,
      actorId,
      role,
      e.action,
      e.entity,
      e.entityId ?? null,
      e.patientId ?? null,
      e.clinicId ?? null,
      meta?.ip ?? null,
      meta?.userAgent?.slice(0, 300) ?? null,
      e.reason ?? null,
      e.details ? JSON.stringify(e.details) : null,
    ]);
  }
}

/** Convenience wrapper: run a unit of work under the principal's RLS context. */
@Injectable()
export class Tenancy {
  constructor(@Inject(DB) readonly db: Database) {}
  run<T>(p: Principal, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.withTenant(tenantOf(p), fn);
  }
  system<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.withTenant({ orgId, mode: 'system', network: true }, fn);
  }
  ctx<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.withTenant(ctx, fn);
  }
}
