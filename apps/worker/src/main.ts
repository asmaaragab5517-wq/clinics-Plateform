import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServer } from 'node:http';
import { CoreModule, loadConfig } from '@hf/api/dist/core';
import * as jobs from './jobs';
import { SCHEDULE, cronMatches } from './schedule';

const log = new Logger('Worker');

async function main() {
  const cfg = loadConfig();
  if (cfg.CHROMIUM_PATH) process.env.CHROMIUM_PATH = cfg.CHROMIUM_PATH;
  const app = await NestFactory.createApplicationContext(CoreModule.forRoot(cfg), { logger: ['error', 'warn', 'log'] });
  const c = jobs.jobContext(app);
  const run: Record<string, () => Promise<unknown>> = {
    'dispatch-messages': () => jobs.dispatchMessages(c),
    'expire-holds': () => jobs.expireHolds(c),
    reminders: () => jobs.reminders(c, cfg.PUBLIC_SITE_URL),
    'no-shows': () => jobs.markNoShows(c),
    'refresh-reports': () => jobs.refreshReports(c),
    'follow-ups-waitlist': () => jobs.followUpsAndWaitlist(c, cfg.PUBLIC_SITE_URL),
    reconcile: () => jobs.reconcile(c),
    'verify-audit': () => jobs.verifyAudit(c),
    retention: () => jobs.retention(c),
    'director-summary': () => jobs.directorSummary(c),
    commissions: () => jobs.commissions(c),
    telemedicine: () => jobs.prepareTelemedicine(c),
    'calendar-sync': () => jobs.syncCalendars(c),
    'eta-receipts': () => jobs.submitEtaReceipts(c),
    'outbound-events': () => jobs.deliverEvents(c),
    'next-slots': () => jobs.refreshNextSlots(c),
    'retention-review': () => jobs.retentionReview(c),
    'prune-device-tokens': () => jobs.pruneDeviceTokens(c),
    'hr-close-day': () => jobs.hrCloseDay(c),
  };
  const running = new Set<string>();
  const exec = async (name: string) => {
    if (running.has(name)) return;
    running.add(name);
    const t0 = Date.now();
    try {
      const r = await run[name]!();
      if (Date.now() - t0 > 2000 || (typeof r === 'number' && r > 0)) log.log(`${name} done in ${Date.now() - t0} ms${typeof r === 'number' ? ` (${r})` : ''}`);
    } catch (e) {
      log.error(`${name} failed: ${(e as Error).message}`);
    } finally {
      running.delete(name);
    }
  };

  if (cfg.REDIS_URL) {
    // BullMQ repeatable jobs ensure each job runs once across worker replicas.
    const { Queue, Worker } = await import('bullmq');
    const connection = { url: cfg.REDIS_URL } as never;
    const queue = new Queue('hf-scheduler', { connection });
    for (const j of SCHEDULE) {
      await queue.upsertJobScheduler(j.name, j.every ? { every: j.every } : { pattern: j.cron!, tz: 'Africa/Cairo' }, { name: j.name, opts: { removeOnComplete: 100, removeOnFail: 500 } });
    }
    new Worker('hf-scheduler', async (job) => exec(job.name), { connection, concurrency: 4 });
    log.log(`BullMQ scheduler started with ${SCHEDULE.length} jobs`);
  } else {
    log.warn('REDIS_URL not set: using the in-process development scheduler');
    for (const j of SCHEDULE.filter((x) => x.every)) setInterval(() => void exec(j.name), j.every);
    let lastMinute = -1;
    setInterval(() => {
      const now = new Date();
      if (now.getUTCMinutes() === lastMinute) return;
      lastMinute = now.getUTCMinutes();
      for (const j of SCHEDULE.filter((x) => x.cron)) if (cronMatches(j.cron!, now)) void exec(j.name);
    }, 10_000);
  }

  createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok', running: [...running] }));
  }).listen(Number(process.env.WORKER_HEALTH_PORT ?? 4100));
  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
void main();
