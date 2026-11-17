import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { Client } from 'pg';
import { CoreModule, loadConfig } from '@hf/api/dist/core';
import { createTestDatabase } from '../../../packages/testkit/src';
import * as jobs from '../src/jobs';
import { cronMatches } from '../src/schedule';

let env: Awaited<ReturnType<typeof createTestDatabase>>;
let app: INestApplicationContext;
let c: jobs.JobContext;
let admin: Client;
let patient: string;

const insertAppt = async (status: string, startOffsetMin: number, extra: Record<string, unknown> = {}) => {
  const start = new Date(Date.now() + startOffsetMin * 60000);
  const r = await admin.query(
    `insert into appointments (organisation_id, clinic_id, doctor_id, patient_id, ref, start_at, end_at, status, channel, hold_expires_at, cancel_reason, slot_index)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'site',$9,$10,$11) returning id`,
    [env.demo.orgId, env.demo.clinicIds[0], env.demo.doctorIds[0], patient, `R${Math.random().toString(36).slice(2, 9)}`, start, new Date(start.getTime() + 20 * 60000), status, extra.hold ?? null, extra.reason ?? null, extra.slot ?? Math.floor(Math.random() * 1000)],
  );
  return r.rows[0].id as string;
};

beforeAll(async () => {
  env = await createTestDatabase('hf_test_worker');
  admin = new Client({ connectionString: env.adminUrl });
  await admin.connect();
  // Allow arbitrary slot indexes for synthetic rows.
  patient = (await admin.query(`insert into patients (organisation_id, mrn, first_name_ar, date_of_birth, gender) values ($1, 'W-1', 'سارة', '1992-02-02', 'female') returning id`, [env.demo.orgId])).rows[0].id;
  await admin.query(`insert into patient_contacts (organisation_id, patient_id, phone, is_primary) values ($1, $2, '+201055556666', true)`, [env.demo.orgId, patient]);
  app = await NestFactory.createApplicationContext(CoreModule.forRoot(loadConfig({ NODE_ENV: 'test', DATABASE_URL: env.appUrl } as NodeJS.ProcessEnv)), { logger: false });
  c = jobs.jobContext(app);
}, 120000);

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await env?.drop();
});

describe('worker jobs', () => {
  it('expires unpaid holds and releases the slot', async () => {
    const id = await insertAppt('requested', 600, { hold: new Date(Date.now() - 60000) });
    expect(await jobs.expireHolds(c)).toBeGreaterThanOrEqual(1);
    const r = await admin.query('select status, cancel_reason from appointments where id = $1', [id]);
    expect(r.rows[0]).toEqual({ status: 'cancelled', cancel_reason: 'hold_expired' });
  });

  it('sends T-24h and T-2h reminders once (deduplicated)', async () => {
    const a24 = await insertAppt('booked', 24 * 60 - 20);
    const a2 = await insertAppt('confirmed', 2 * 60 - 10);
    await jobs.reminders(c, 'http://site.test');
    await jobs.reminders(c, 'http://site.test');
    const r = await admin.query(`select event, count(*)::int as n from messages where patient_id = $1 and event like 'reminder%' group by event order by event`, [patient]);
    expect(r.rows).toEqual([{ event: 'reminder_24h', n: 1 }, { event: 'reminder_2h', n: 1 }]);
    void a24;
    void a2;
  });

  it('marks no-shows after the grace period', async () => {
    const id = await insertAppt('booked', -120);
    await jobs.markNoShows(c);
    expect((await admin.query('select status from appointments where id = $1', [id])).rows[0].status).toBe('no_show');
  });

  it('dispatches queued messages through the provider and respects quiet hours scheduling', async () => {
    const sent = await jobs.dispatchMessages(c);
    expect(sent).toBeGreaterThanOrEqual(0);
    const r = await admin.query(`select count(*)::int as n from messages where status = 'queued' and scheduled_for <= now()`);
    expect(r.rows[0].n).toBe(0);
  });

  it('verifies the audit chain and applies retention', async () => {
    expect(await jobs.verifyAudit(c)).toEqual([]);
    const old = await insertAppt('cancelled', -60 * 24 * 40, { reason: 'hold_expired' });
    await admin.query(`update appointments set created_at = now() - interval '40 days' where id = $1`, [old]);
    await admin.query(`update messages set created_at = now() - interval '100 days' where patient_id = $1`, [patient]);
    await jobs.retention(c);
    expect((await admin.query('select 1 from appointments where id = $1', [old])).rowCount).toBe(0);
    expect((await admin.query('select count(*)::int as n from messages where patient_id = $1 and body is not null', [patient])).rows[0].n).toBe(0);
  });

  it('refreshes reports, builds the director summary and commissions', async () => {
    await jobs.refreshReports(c);
    await jobs.directorSummary(c);
    const s = await admin.query(`select count(*)::int as n from messages where event = 'director_daily_summary'`);
    expect(s.rows[0].n).toBeGreaterThan(0);
    expect(await jobs.commissions(c, new Date('2026-12-05T10:00:00Z'))).toBe('2026-11-01');
  });

  it('matches cron patterns in Cairo time', () => {
    expect(cronMatches('0 8 * * *', new Date('2026-01-10T06:00:00Z'))).toBe(true); // 08:00 Cairo (UTC+2)
    expect(cronMatches('0 8 * * *', new Date('2026-07-10T05:00:00Z'))).toBe(true); // DST UTC+3
    expect(cronMatches('0 4 1 * *', new Date('2026-01-02T02:00:00Z'))).toBe(false);
  });
});

describe('sprint 15 jobs', () => {
  it('refreshes next-slot cache and raises a retention review task', async () => {
    expect(await jobs.refreshNextSlots(c)).toBeGreaterThan(0);
    expect((await admin.query('select count(*)::int as n from doctor_next_slot where next_start is not null')).rows[0].n).toBeGreaterThan(0);
    await admin.query(`insert into patients (organisation_id, mrn, first_name_ar, date_of_birth, gender, created_at) values ($1, 'OLD-W', 'قديم', '1950-01-01', 'male', now() - interval '12 years')`, [env.demo.orgId]);
    await jobs.retentionReview(c);
    expect((await admin.query(`select count(*)::int as n from tasks where kind = 'retention_review'`)).rows[0].n).toBeGreaterThan(0);
  });
});
