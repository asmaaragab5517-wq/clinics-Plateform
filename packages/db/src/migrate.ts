import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

/** Apply pending SQL migrations in order, each in its own transaction. Uses the admin (owner) connection. */
export async function migrate(adminUrl: string, opts: { appUser?: string; appPassword?: string; log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => undefined);
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock(727272)');
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const applied = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      if (applied.has(file)) continue;
      log(`applying ${file}`);
      await client.query('begin');
      try {
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    }
    if (opts.appUser && opts.appPassword) {
      if (!/^[a-z_][a-z0-9_]*$/.test(opts.appUser)) throw new Error('invalid app user name');
      const exists = (await client.query('select 1 from pg_roles where rolname = $1', [opts.appUser])).rowCount;
      const pw = opts.appPassword.replace(/'/g, "''");
      await client.query(
        exists
          ? `alter role ${opts.appUser} with login nobypassrls password '${pw}'`
          : `create role ${opts.appUser} with login nobypassrls password '${pw}' in role hf_app`,
      );
    }
  } finally {
    await client.query('select pg_advisory_unlock(727272)').catch(() => undefined);
    await client.end();
  }
}
