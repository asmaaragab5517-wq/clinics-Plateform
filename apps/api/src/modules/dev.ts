import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Webhook } from '../common/decorators';
import { notFound } from '../common/errors';
import { CONFIG, type Config } from '../config';
import { MemoryStorage, STORAGE, type Storage } from '../integrations/storage';

/** Development-only file serving for the in-memory storage adapter's signed URLs. */
@Controller('v1/dev')
export class DevController {
  constructor(@Inject(STORAGE) private readonly storage: Storage, @Inject(CONFIG) private readonly cfg: Config) {}

  @Get('files')
  @Webhook()
  async file(@Query('key') key: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    if (this.cfg.isProd || !(this.storage instanceof MemoryStorage) || !this.storage.verify(key, Number(exp), sig)) throw notFound();
    const obj = await this.storage.get(key);
    if (!obj) throw notFound();
    res.setHeader('content-type', obj.contentType).setHeader('cache-control', 'no-store').send(obj.body);
  }
}

@Controller()
export class HealthController {
  @Get('health')
  @Webhook()
  health() {
    return { status: 'ok', at: new Date().toISOString() };
  }
}
