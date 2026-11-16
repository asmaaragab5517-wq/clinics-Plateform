import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export type TenantMode = 'staff' | 'patient' | 'public' | 'system';

export interface TenantContext {
  orgId: string;
  mode: TenantMode;
  userId?: string | null;
  network?: boolean;
  clinicIds?: string[];
  patientIds?: string[];
}

export interface Tx {
  query<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<R[]>;
  one<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<R>;
  maybeOne<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<R | null>;
  ctx: TenantContext;
}

export class NotFoundError extends Error {
  constructor(what = 'row') {
    super(`${what} not found`);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidList(ids: string[] | undefined): string {
  for (const id of ids ?? []) if (!UUID.test(id)) throw new Error('invalid uuid in tenant context');
  return (ids ?? []).join(',');
}

/** Wrap a client as a Tx helper. */
function wrap(client: PoolClient, ctx: TenantContext): Tx {
  return {
    ctx,
    async query(sql, params) {
      return (await client.query(sql, params as unknown[])).rows;
    },
    async one(sql, params) {
      const rows = (await client.query(sql, params as unknown[])).rows;
      if (!rows[0]) throw new NotFoundError();
      return rows[0];
    },
    async maybeOne(sql, params) {
      return (await client.query(sql, params as unknown[])).rows[0] ?? null;
    },
  };
}

/**
 * Database gateway. Every unit of work runs in a transaction whose RLS session variables are
 * set with `set_config(..., true)` so they cannot leak across pooled connections (MT-1, MT-2).
 */
export class Database {
  readonly pool: Pool;
  constructor(connectionString: string, max = 20) {
    this.pool = new Pool({ connectionString, max });
    this.pool.on('error', () => undefined); // idle client errors are surfaced on next checkout
  }

  async withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!UUID.test(ctx.orgId)) throw new Error('tenant context requires orgId');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `select set_config('app.org_id', $1, true), set_config('app.mode', $2, true),
                set_config('app.network', $3, true), set_config('app.clinic_ids', $4, true),
                set_config('app.patient_ids', $5, true), set_config('app.user_id', $6, true)`,
        [ctx.orgId, ctx.mode, ctx.network ? 'on' : 'off', uuidList(ctx.clinicIds), uuidList(ctx.patientIds), ctx.userId ?? ''],
      );
      const result = await fn(wrap(client, ctx));
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Lookups that happen before a tenant is known (e.g. resolve organisation by slug). Reference tables only. */
  async raw<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<R[]> {
    return (await this.pool.query(sql, params as unknown[])).rows;
  }

  async close() {
    await this.pool.end();
  }
}
