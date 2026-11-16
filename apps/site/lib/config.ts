/** Server-side configuration. API_URL and ORG_SLUG never reach the browser. */
export const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
export const ORG_SLUG = process.env.ORG_SLUG ?? 'demo';
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const REVALIDATE = 300;
