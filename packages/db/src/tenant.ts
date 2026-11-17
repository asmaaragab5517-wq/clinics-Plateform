import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// Keep calendar dates as YYYY-MM-DD strings (no timezone shifts), parse counts and numerics as numbers.
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

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
const MODES = new Set(['staff', 'patient', 'public', 'system']);
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
      // One round trip: BEGIN and the RLS session settings. Every interpolated value is validated above
      // (UUIDs, a fixed set of modes), so no user-controlled text reaches this statement.
      if (!MODES.has(ctx.mode)) throw new Error('invalid tenant mode');
      if (ctx.userId && !UUID.test(ctx.userId)) throw new Error('invalid user id in tenant context');
      await client.query(
        `begin; select set_config('app.org_id', '${ctx.orgId}', true), set_config('app.mode', '${ctx.mode}', true),
                set_config('app.network', '${ctx.network ? 'on' : 'off'}', true), set_config('app.clinic_ids', '${uuidList(ctx.clinicIds)}', true),
                set_config('app.patient_ids', '${uuidList(ctx.patientIds)}', true), set_config('app.user_id', '${ctx.userId ?? ''}', true)`,
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
