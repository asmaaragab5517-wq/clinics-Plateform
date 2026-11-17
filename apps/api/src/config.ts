import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('postgres://hf_api:hf_api@localhost:5432/healthflow'),
  REDIS_URL: z.string().optional(),
  FIELD_ENCRYPTION_KEY: z.string().optional(),
  PUBLIC_SITE_URL: z.string().default('http://localhost:3000'),
  CONSOLE_URL: z.string().default('http://localhost:3001'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  DEFAULT_ORG_SLUG: z.string().default('demo'),
  // Staff auth (Keycloak OIDC)
  KEYCLOAK_ISSUER: z.string().optional(),
  KEYCLOAK_AUDIENCE: z.string().default('healthflow-api'),
  STAFF_REQUIRE_MFA: bool.default('true'),
  AUTH_DEV_SECRET: z.string().optional(),
  // Patient auth
  PATIENT_JWT_SECRET: z.string().min(32).default('dev-only-patient-jwt-secret-change-me-0123456789'),
  OTP_PEPPER: z.string().default('dev-otp-pepper'),
  OTP_DEV_ECHO: bool.default('false'),
  DISPLAY_TOKEN_SECRET: z.string().default('dev-display-token-secret'),
  SHARE_LINK_SECRET: z.string().default('dev-share-link-secret'),
  // Integrations
  HEALTHPAY_MODE: z.enum(['fake', 'http']).default('fake'),
  HEALTHPAY_BASE_URL: z.string().default('https://sandbox.healthpay.example/api'),
  HEALTHPAY_WEBHOOK_SECRET: z.string().default('dev-healthpay-webhook-secret'),
  CEQUENS_MODE: z.enum(['fake', 'http']).default('fake'),
  CEQUENS_BASE_URL: z.string().default('https://apis.cequens.com'),
  CEQUENS_API_KEY: z.string().optional(),
  CEQUENS_SENDER_AR: z.string().default('HealthFlow'),
  CEQUENS_SENDER_EN: z.string().default('HealthFlow'),
  CEQUENS_WEBHOOK_SECRET: z.string().default('dev-cequens-webhook-secret'),
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('HealthFlow Clinics <no-reply@healthflow.example>'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('fra1'),
  S3_BUCKET: z.string().default('healthflow-private'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  STORAGE_MODE: z.enum(['memory', 's3']).default('memory'),
  AV_MODE: z.enum(['clamd', 'disabled']).default('disabled'),
  CLAMD_HOST: z.string().default('localhost'),
  CLAMD_PORT: z.coerce.number().default(3310),
  CHROMIUM_PATH: z.string().optional(),
  TELEMED_PROVIDER: z.enum(['fake', 'zoom', 'google_meet']).default('fake'),
  ZOOM_ACCOUNT_ID: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),
  GOOGLE_MODE: z.enum(['fake', 'http']).default('fake'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  AI_MODE: z.enum(['fake', 'anthropic']).default('fake'),
  STT_MODE: z.enum(['fake', 'http']).default('fake'),
  STT_BASE_URL: z.string().default('http://localhost:9000/v1'),
  STT_API_KEY: z.string().optional(),
  STT_MODEL: z.string().default('whisper-1'),
  ETA_MODE: z.enum(['fake', 'http']).default('fake'),
  APP_RETURN_URL: z.string().regex(/^(healthflow:\/\/|https:\/\/)/).default('healthflow://book/result'),
  SUPPORT_TOKEN_SECRET: z.string().default('dev-support-token-secret'),
  PLATFORM_HEALTHPAY_MERCHANT_ID: z.string().optional(),
  PLATFORM_HEALTHPAY_API_KEY: z.string().optional(),
  RATE_LIMIT_APIKEY_PER_MIN: z.coerce.number().int().positive().default(600),
  OAUTH_STATE_SECRET: z.string().default('dev-oauth-state-secret'),
  DB_POOL_MAX: z.coerce.number().int().min(2).max(200).default(30),
  PUBLIC_CACHE_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
  RATE_LIMIT_PUBLIC_PER_MIN: z.coerce.number().int().positive().default(240),
  RATE_LIMIT_PATIENT_PER_MIN: z.coerce.number().int().positive().default(300),
});

export type Config = z.infer<typeof schema> & { isProd: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(env);
  const isProd = c.NODE_ENV === 'production';
  if (isProd) {
    const missing = (['FIELD_ENCRYPTION_KEY', 'KEYCLOAK_ISSUER', 'REDIS_URL'] as const).filter((k) => !c[k]);
    if (missing.length) throw new Error(`Missing production configuration: ${missing.join(', ')}`);
    if (c.AUTH_DEV_SECRET || c.OTP_DEV_ECHO) throw new Error('Dev auth options must not be enabled in production');
    if (c.PATIENT_JWT_SECRET.startsWith('dev-') || c.HEALTHPAY_MODE === 'fake' || c.CEQUENS_MODE === 'fake' || c.STORAGE_MODE === 'memory' || c.AV_MODE === 'disabled' || c.OAUTH_STATE_SECRET.startsWith('dev-') || c.SUPPORT_TOKEN_SECRET.startsWith('dev-')) {
      throw new Error('Production requires real secrets, HealthPay, Cequens, S3 storage and antivirus');
    }
  }
  return { ...c, isProd };
}

export const CONFIG = Symbol('CONFIG');
