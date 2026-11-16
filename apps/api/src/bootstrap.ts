import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig, type Config } from './config';

export async function createApp(cfg: Config = loadConfig(), opts: { logger?: false } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(cfg), { rawBody: true, logger: opts.logger === false ? false : ['error', 'warn', 'log'] });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // API returns JSON/PDF only: strict CSP, no framing, HSTS (SEC-2, SEC-6).
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'", cfg.PUBLIC_SITE_URL] } }, hsts: { maxAge: 31536000, includeSubDomains: true } }));
  app.enableCors({ origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true, allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-org', 'x-client'] });
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '100kb' });
  app.enableShutdownHooks();
  return app;
}
