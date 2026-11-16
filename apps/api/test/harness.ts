import 'reflect-metadata';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase } from '../../../packages/testkit/src';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { CHANNELS } from '../src/integrations/messaging';
import { HEALTHPAY } from '../src/integrations/healthpay';
import type { FakeHealthPayClient } from '../src/integrations/healthpay';
import type { FakeProvider } from '../src/integrations/messaging';

export type Env = Awaited<ReturnType<typeof createTestDatabase>>;

export interface Harness {
  app: INestApplication;
  env: Env;
  http: () => request.Agent;
  staff: Record<string, string>; // persona → bearer token
  otherStaff: Record<string, string>;
  healthpay: FakeHealthPayClient;
  sms: FakeProvider;
  close: () => Promise<void>;
}

export const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';

export async function startHarness(dbName: string): Promise<Harness> {
  const env = await createTestDatabase(dbName);
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: env.appUrl,
    AUTH_DEV_SECRET: 'test-dev-secret-0123456789abcdef',
    OTP_DEV_ECHO: 'true',
    CHROMIUM_PATH: CHROMIUM,
    API_PUBLIC_URL: 'http://api.test',
    PUBLIC_SITE_URL: 'http://site.test',
  } as NodeJS.ProcessEnv);
  const app = await createApp(cfg, { logger: false });
  await app.init();
  const http = () => request.agent(app.getHttpServer());
  const token = async (email: string, org: string) => {
    const r = await http().post('/v1/auth/dev/staff-token').set('x-org', org).send({ email });
    if (r.status !== 200) throw new Error(`token for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.accessToken as string;
  };
  const personas = ['owner', 'director', 'manager', 'reception', 'reception2', 'nurse', 'accountant'];
  const doctors = { dr_ahmed: 'ahmed-samy', dr_mona: 'mona-khaled', dr_sara: 'sara-adel' };
  const staff: Record<string, string> = {};
  const otherStaff: Record<string, string> = {};
  for (const [org, target] of [['demo', staff], ['other', otherStaff]] as const) {
    for (const p of personas) target[p] = await token(`${p}@${org}.healthflow.eg`, org);
    for (const [k, slug] of Object.entries(doctors)) target[k] = await token(`${slug}@${org}.healthflow.eg`, org);
  }
  const channels = app.get(CHANNELS) as { sms: FakeProvider };
  return {
    app, env, http, staff, otherStaff,
    healthpay: app.get(HEALTHPAY) as FakeHealthPayClient,
    sms: channels.sms,
    close: async () => {
      await app.close();
      const { closeRenderer } = await import('@hf/documents');
      await closeRenderer();
      await env.drop();
    },
  };
}

/** Sign in a patient by OTP (dev echo) and return tokens. */
export async function patientLogin(h: Harness, phone: string, org = 'demo') {
  const req = await h.http().post('/v1/auth/otp/request').set('x-org', org).send({ phone });
  if (req.status !== 200) throw new Error(`otp request ${req.status} ${JSON.stringify(req.body)}`);
  const ver = await h.http().post('/v1/auth/otp/verify').set('x-org', org).send({ phone, code: req.body.devCode });
  if (ver.status !== 200) throw new Error(`otp verify ${ver.status} ${JSON.stringify(ver.body)}`);
  return ver.body as { accessToken: string; refreshToken: string; accountId: string };
}

export const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/** Valid synthetic National ID for a DOB/gender (check digit is not validated). */
export function nationalIdFor(dob: string, gender: 'male' | 'female', seq = 123, gov = '01'): string {
  const [y, m, d] = dob.split('-');
  const century = Number(y) >= 2000 ? '3' : '2';
  const genderDigit = gender === 'male' ? '1' : '2';
  return `${century}${y!.slice(2)}${m}${d}${gov}${String(seq).padStart(3, '0')}${genderDigit}5`;
}
