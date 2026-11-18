import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { auth, startHarness, type Harness } from './harness';
import { createApp } from '../src/bootstrap';

let h: Harness;
let replica: INestApplication;
const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';

beforeAll(async () => {
  h = await startHarness('hf_test_api_cache', { REDIS_URL: redisUrl, PUBLIC_CACHE_SECONDS: '60' });
  replica = await createApp(h.cfg, { logger: false });
  await replica.init();
}, 180000);
afterAll(async () => {
  await replica?.close();
  await h?.close();
});

describe('public catalogue cache shared through Redis', () => {
  it('serves cached reads and shows a write made on another replica immediately', async () => {
    const a = () => request(replica.getHttpServer()).get('/v1/public/clinics').set('x-org', 'demo');
    const first = await a();
    const clinic = first.body[0];
    expect(clinic).toBeTruthy();
    // A change made straight in the database (no API write, so no invalidation) is not visible yet: the read is cached.
    const admin = new Client({ connectionString: h.env.adminUrl });
    await admin.connect();
    await admin.query('update clinics set name_en = $2 where id = $1', [clinic.id, 'Changed behind the cache']);
    await admin.end();
    expect((await a()).body.find((c: { id: string }) => c.id === clinic.id).name_en).toBe(clinic.name_en);
    // A write on the other replica (the harness app) bumps the organisation's cache version in Redis.
    const renamed = `${clinic.name_en} (renamed)`;
    await h.http().patch(`/v1/clinics/${clinic.id}`).set(auth(h.staff.owner!)).send({ name: { ar: clinic.name_ar, en: renamed } }).expect(200);
    const after = await a();
    expect(after.body.find((c: { id: string }) => c.id === clinic.id).name_en).toBe(renamed);
  });
});
