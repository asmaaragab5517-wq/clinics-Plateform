import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { createApp } from './bootstrap';
import { loadConfig } from './config';
import { openApiDocument } from './openapi';

async function main() {
  const app = await createApp(loadConfig({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), { logger: false });
  const doc = openApiDocument(app);
  const out = process.argv[2] ?? '../../docs/openapi.json';
  writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log(`wrote ${Object.keys(doc.paths).length} paths to ${out}`);
  await app.close();
  process.exit(0);
}
void main();
