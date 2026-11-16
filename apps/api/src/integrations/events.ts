import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Observable } from 'rxjs';
import { CONFIG, type Config } from '../config';

/**
 * Real-time fan-out for queue screens (FR-APT-5/6). Uses Redis pub/sub when configured so every API
 * instance receives events; falls back to an in-process emitter in development.
 */
@Injectable()
export class EventBus implements OnModuleDestroy {
  private readonly local = new EventEmitter().setMaxListeners(0);
  private pub: import('ioredis').default | null = null;
  private sub: import('ioredis').default | null = null;
  private ready: Promise<void> | null = null;

  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  private init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      if (!this.cfg.REDIS_URL) return;
      const Redis = (await import('ioredis')).default;
      this.pub = new Redis(this.cfg.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2 });
      this.sub = new Redis(this.cfg.REDIS_URL, { lazyConnect: false });
      await this.sub.psubscribe('hf:*');
      this.sub.on('pmessage', (_p, channel, message) => this.local.emit(channel.slice(3), JSON.parse(message)));
    })();
    return this.ready;
  }

  async publish(topic: string, payload: unknown) {
    await this.init();
    if (this.pub) await this.pub.publish(`hf:${topic}`, JSON.stringify(payload));
    else this.local.emit(topic, payload);
  }

  stream<T>(topic: string): Observable<T> {
    void this.init();
    return new Observable<T>((sub) => {
      const h = (p: T) => sub.next(p);
      this.local.on(topic, h);
      return () => this.local.off(topic, h);
    });
  }

  async onModuleDestroy() {
    await this.pub?.quit().catch(() => undefined);
    await this.sub?.quit().catch(() => undefined);
  }
}
