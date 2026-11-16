import 'reflect-metadata';
import { createApp } from './bootstrap';
import { loadConfig } from './config';

async function main() {
  const cfg = loadConfig();
  const app = await createApp(cfg);
  if (!cfg.isProd) {
    const { SwaggerModule } = await import('@nestjs/swagger');
    const { openApiDocument } = await import('./openapi');
    SwaggerModule.setup('v1/docs', app, openApiDocument(app));
  }
  await app.listen(cfg.PORT, '0.0.0.0');
  console.log(`HealthFlow API listening on ${cfg.PORT}`);
}
void main();
