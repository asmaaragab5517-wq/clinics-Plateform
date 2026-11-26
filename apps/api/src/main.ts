import 'reflect-metadata';
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';
import { createApp } from './bootstrap';
import { loadConfig } from './config';

async function serve() {
  const cfg = loadConfig();
  const app = await createApp(cfg);
  if (!cfg.isProd) {
    const { SwaggerModule } = await import('@nestjs/swagger');
    const { openApiDocument } = await import('./openapi');
    SwaggerModule.setup('v1/docs', app, openApiDocument(app));
  }
  // '::' accepts IPv6 and IPv4 on Linux (private networks such as Railway's reach services over IPv6); hosts
  // without IPv6 fall back to IPv4. HOST overrides both.
  if (process.env.HOST) await app.listen(cfg.PORT, process.env.HOST);
  else {
    try {
      await app.listen(cfg.PORT, '::');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EAFNOSUPPORT') throw e;
      await app.listen(cfg.PORT, '0.0.0.0');
    }
  }
  console.log(`HealthFlow API listening on ${cfg.PORT}${cluster.isWorker ? ` (worker ${process.pid})` : ''}`);
}

/**
 * API_WORKERS: number of processes sharing the port (0 = one per CPU). Defaults to 1 because containers are
 * scaled horizontally; set it on a single large host. Rate limits are shared through Redis, so when REDIS_URL
 * is unset each process keeps its own counters and the effective limit is multiplied by the process count.
 */
const workers = process.env.API_WORKERS === '0' ? availableParallelism() : Number(process.env.API_WORKERS ?? 1);
if (cluster.isPrimary && workers > 1) {
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on('exit', (w, code) => {
    console.error(`API worker ${w.process.pid} exited (${code}); restarting`);
    cluster.fork();
  });
} else {
  void serve();
}
