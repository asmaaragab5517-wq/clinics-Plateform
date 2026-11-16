import { migrate } from './migrate';

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('DATABASE_ADMIN_URL is required');
migrate(url, { appUser: process.env.DATABASE_APP_USER ?? 'hf_api', appPassword: process.env.DATABASE_APP_PASSWORD, log: console.log })
  .then(() => console.log('migrations complete'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
