import { Client } from 'pg';
import { SecretBox, devKey } from './crypto';
import { migrate } from './migrate';
import { seedDemo, seedReference } from './seed';

/**
 * Release step for hosted environments (one command, no shell): apply migrations, load reference data, and with
 * HF_SEED_DEMO=1 (never in production) seed the demo organisation the first time.
 */
async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required');
  await migrate(url, { appUser: process.env.DATABASE_APP_USER ?? 'hf_api', appPassword: process.env.DATABASE_APP_PASSWORD, log: console.log });
  console.log('migrations complete');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await seedReference(c);
    console.log('reference data loaded');
    if (process.env.HF_SEED_DEMO !== '1') return;
    if (process.env.NODE_ENV === 'production') throw new Error('refusing to seed demo data in production');
    if ((await c.query(`select 1 from organisations where slug = 'demo'`)).rowCount) {
      console.log('demo organisation already seeded');
      return;
    }
    const ids = await seedDemo(c, new SecretBox(process.env.FIELD_ENCRYPTION_KEY ?? devKey()));
    console.log(`demo organisation seeded (${ids.orgId})`);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
