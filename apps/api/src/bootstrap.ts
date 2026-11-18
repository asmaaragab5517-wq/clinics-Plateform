import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig, type Config } from './config';

/** `ip|unixSeconds|hex(hmac-sha256(secret, "ip|unixSeconds"))` from a proxy sharing the secret. */
export function verifyClientIp(header: string, secret: string, now = Date.now()): string | null {
  const [ip, ts, sig] = header.split('|');
  if (!ip || !ts || !sig || !/^[\d.:a-fA-F]{3,45}$/.test(ip) || Math.abs(now / 1000 - Number(ts)) > 60) return null;
  const want = createHmac('sha256', secret).update(`${ip}|${ts}`).digest();
  const got = Buffer.from(sig, 'hex');
  return got.length === want.length && timingSafeEqual(got, want) ? ip : null;
}

export async function createApp(cfg: Config = loadConfig(), opts: { logger?: false } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(cfg), { rawBody: true, logger: opts.logger === false ? false : ['error', 'warn', 'log'] });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // API returns JSON/PDF only: strict CSP, no framing, HSTS (SEC-2, SEC-6).
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'", cfg.PUBLIC_SITE_URL] } }, hsts: { maxAge: 31536000, includeSubDomains: true } }));
  app.enableCors({ origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true, allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-org', 'x-client'] });
  // Trusted client address from our own web proxies (site/console), signed with CLIENT_IP_SECRET and valid for 60 s.
  app.use((req: Request & { clientIp?: string }, _res: unknown, next: () => void) => {
    const h = req.headers['x-hf-client-ip'];
    if (cfg.CLIENT_IP_SECRET && typeof h === 'string') {
      const ip = verifyClientIp(h, cfg.CLIENT_IP_SECRET);
      if (ip) req.clientIp = ip;
    }
    next();
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '100kb' });
  app.enableShutdownHooks();
  return app;
}
