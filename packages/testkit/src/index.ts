import { Client } from 'pg';
import { SecretBox, devKey, migrate, seedDemo, seedReference, type DemoIds } from '@hf/db';

export const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
export const APP_PASSWORD = 'hf_test_pw';

/** Create a fresh database, migrate, seed reference + two demo organisations (for isolation tests). */
export async function createTestDatabase(name: string): Promise<{ adminUrl: string; appUrl: string; demo: DemoIds; other: DemoIds; box: SecretBox; drop: () => Promise<void> }> {
  const root = new Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`drop database if exists ${name} with (force)`);
  await root.query(`create database ${name}`);
  await root.end();
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  const adminUrl = u.toString();
  await migrate(adminUrl, { appUser: 'hf_api_test', appPassword: APP_PASSWORD });
  const box = new SecretBox(devKey());
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  await seedReference(c);
  const demo = await seedDemo(c, box);
  const other = await seedDemo(c, box, { slug: 'other', name: 'شبكة أخرى' });
  await c.end();
  const app = new URL(adminUrl);
  app.username = 'hf_api_test';
  app.password = APP_PASSWORD;
  return {
    adminUrl,
    appUrl: app.toString(),
    demo,
    other,
    box,
    drop: async () => {
      const r = new Client({ connectionString: ADMIN_URL });
      await r.connect();
      await r.query(`drop database if exists ${name} with (force)`);
      await r.end();
    },
  };
}
