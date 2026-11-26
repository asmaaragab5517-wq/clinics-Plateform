import { Client } from 'pg';
import { SecretBox, devKey } from './crypto';
import { seedDemo, seedReference } from './seed';

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await seedReference(c);
    if (process.argv.includes('--demo')) {
      if (process.env.NODE_ENV === 'production') throw new Error('refusing to seed demo data in production');
      // --if-missing: safe to run on every deploy of a staging environment (seeds the demo organisation once).
      if (process.argv.includes('--if-missing') && (await c.query(`select 1 from organisations where slug = 'demo'`)).rowCount) {
        console.log('demo organisation already seeded');
        return;
      }
      const ids = await seedDemo(c, new SecretBox(process.env.FIELD_ENCRYPTION_KEY ?? devKey()));
      console.log(JSON.stringify(ids, null, 2));
    }
  } finally {
    await c.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
