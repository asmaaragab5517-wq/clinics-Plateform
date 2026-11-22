import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { auth, startHarness, type Harness } from './harness';

let h: Harness;
async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: h.env.adminUrl });
  await c.connect();
  try {
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  h = await startHarness('hf_test_api_idem');
  const mgr = await h.http().get('/v1/auth/me').set(auth(h.staff.manager!));
  const nurse = await h.http().get('/v1/auth/me').set(auth(h.staff.nurse!));
  const r = await h.http().put(`/v1/hr/staff/${nurse.body.userId}/contract`).set(auth(h.staff.owner!)).send({
    clinicId: mgr.body.memberships.find((m: { clinicId: string | null }) => m.clinicId)?.clinicId,
    jobTitleAr: 'ممرضة', employmentType: 'full_time', payBasis: 'monthly', startDate: '2026-01-01', baseSalary: 1500000,
    workPattern: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' },
  });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
}, 180000);
afterAll(async () => {
  await h?.close();
});

describe('Idempotency-Key', () => {
  const clock = (key: string, action: 'in' | 'out' = 'in') =>
    h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.nurse!)).set('idempotency-key', key).send({ action });

  it('replays the stored response for a retry instead of acting twice', async () => {
    const first = await clock('k-clock-1');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const again = await clock('k-clock-1');
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    // Without the key the same action is a real second request and is refused.
    const plain = await h.http().post('/v1/hr/attendance/clock').set(auth(h.staff.nurse!)).send({ action: 'in' });
    expect(plain.body.error).toBe('already_clocked_in');
  });

  it('refuses the same key for a different request', async () => {
    const r = await clock('k-clock-1', 'out');
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('idempotency_key_reused');
  });

  it('releases the key when the request fails, so a corrected retry can run', async () => {
    const bad = await clock('k-clock-2', 'in');
    expect(bad.body.error).toBe('already_clocked_in');
    const rows = await sql<{ n: number }>(`select count(*)::int as n from idempotency_responses where key = 'k-clock-2'`);
    expect(rows[0]!.n).toBe(0);
  });

  it('refuses a retry while the first request is still running', async () => {
    const me = await h.http().get('/v1/auth/me').set(auth(h.staff.nurse!));
    const hash = createHash('sha256').update(`POST /v1/hr/attendance/clock\n${JSON.stringify({ action: 'out' })}`).digest('hex');
    await sql(
      `insert into idempotency_responses (organisation_id, actor_id, key, request_hash) select organisation_id, $1, 'k-busy', $2 from staff_memberships where user_id = $1 limit 1`,
      [me.body.userId, hash],
    );
    const r = await clock('k-busy', 'out');
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('request_in_progress');
  });

  it('rejects overlong keys', async () => {
    const r = await clock('x'.repeat(101));
    expect(r.status).toBe(400);
  });
});
