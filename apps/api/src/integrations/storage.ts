import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { connect } from 'node:net';
import { CONFIG, type Config } from '../config';

/** Private object storage (FR-EMR-6, SEC-4): no public listing, 5-minute signed URLs only. */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  signedUrl(key: string, ttlSeconds?: number, downloadName?: string): Promise<string>;
  delete(key: string): Promise<void>;
}
export const STORAGE = Symbol('STORAGE');

@Injectable()
export class MemoryStorage implements Storage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async signedUrl(key: string, ttl = 300) {
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = createHmac('sha256', this.cfg.SHARE_LINK_SECRET).update(`file:${key}:${exp}`).digest('base64url');
    return `${this.cfg.API_PUBLIC_URL}/v1/dev/files?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  }
  verify(key: string, exp: number, sig: string) {
    if (exp < Date.now() / 1000) return false;
    const e = createHmac('sha256', this.cfg.SHARE_LINK_SECRET).update(`file:${key}:${exp}`).digest('base64url');
    return e.length === sig.length && timingSafeEqual(Buffer.from(e), Buffer.from(sig));
  }
}

@Injectable()
export class S3Storage implements Storage {
  private client: import('@aws-sdk/client-s3').S3Client | null = null;
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}
  private async s3() {
    if (!this.client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.client = new S3Client({
        region: this.cfg.S3_REGION,
        endpoint: this.cfg.S3_ENDPOINT,
        forcePathStyle: !!this.cfg.S3_ENDPOINT,
        credentials: this.cfg.S3_ACCESS_KEY ? { accessKeyId: this.cfg.S3_ACCESS_KEY, secretAccessKey: this.cfg.S3_SECRET_KEY! } : undefined,
      });
    }
    return this.client;
  }
  async put(key: string, body: Buffer, contentType: string) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.s3()).send(new PutObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  }
  async get(key: string) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const out = await (await this.s3()).send(new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
      return { body: Buffer.from(await out.Body!.transformToByteArray()), contentType: out.ContentType ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.s3()).send(new DeleteObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
  }
  async signedUrl(key: string, ttl = 300, downloadName?: string) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    return getSignedUrl(await this.s3(), new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key, ResponseContentDisposition: downloadName ? `attachment; filename="${encodeURIComponent(downloadName)}"` : undefined }), { expiresIn: ttl });
  }
}

/** Allowed upload types, detected from magic bytes rather than the client-declared type (SEC-4). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(4, 8).toString() === 'ftyp' && /^(heic|heix|mif1|msf1|hevc)/.test(buf.subarray(8, 12).toString())) return 'image/heic';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'application/zip'; // DICOM bundle
  return null;
}
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type ScanResult = 'clean' | 'infected' | 'error';
export const ANTIVIRUS = Symbol('ANTIVIRUS');
export interface Antivirus {
  scan(buf: Buffer): Promise<ScanResult>;
}

/** ClamAV clamd INSTREAM client. */
@Injectable()
export class ClamdAntivirus implements Antivirus {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}
  scan(buf: Buffer): Promise<ScanResult> {
    return new Promise((resolve) => {
      const sock = connect(this.cfg.CLAMD_PORT, this.cfg.CLAMD_HOST);
      let reply = '';
      sock.setTimeout(30000, () => {
        sock.destroy();
        resolve('error');
      });
      sock.on('error', () => resolve('error'));
      sock.on('data', (d) => (reply += d.toString()));
      sock.on('end', () => resolve(/OK\0?$/.test(reply.trim()) ? 'clean' : /FOUND/.test(reply) ? 'infected' : 'error'));
      sock.on('connect', () => {
        sock.write('zINSTREAM\0');
        for (let i = 0; i < buf.length; i += 64 * 1024) {
          const chunk = buf.subarray(i, i + 64 * 1024);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          sock.write(len);
          sock.write(chunk);
        }
        sock.write(Buffer.alloc(4));
      });
    });
  }
}

/** Development only: flags the EICAR test string, everything else is treated as clean. */
@Injectable()
export class DevAntivirus implements Antivirus {
  async scan(buf: Buffer): Promise<ScanResult> {
    return buf.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'infected' : 'clean';
  }
}
