import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM field encryption ("SecretBox", SEC-2) and HMAC blind indexes for searchable encrypted fields.
 * Layout: version(1) | iv(12) | tag(16) | ciphertext.
 */
export class SecretBox {
  private readonly key: Buffer;
  private readonly indexKey: Buffer;

  constructor(masterKeyB64: string) {
    const master = Buffer.from(masterKeyB64, 'base64');
    if (master.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
    this.key = createHmac('sha256', master).update('hf:enc:v1').digest();
    this.indexKey = createHmac('sha256', master).update('hf:bidx:v1').digest();
  }

  encrypt(plain: string, aad = ''): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    if (aad) c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
  }

  decrypt(box: Buffer, aad = ''): string {
    if (box[0] !== 1) throw new Error('Unknown SecretBox version');
    const d = createDecipheriv('aes-256-gcm', this.key, box.subarray(1, 13), { authTagLength: 16 });
    if (aad) d.setAAD(Buffer.from(aad));
    d.setAuthTag(box.subarray(13, 29));
    return Buffer.concat([d.update(box.subarray(29)), d.final()]).toString('utf8');
  }

  /** Deterministic keyed index, scoped per organisation so equal values differ across tenants. */
  blindIndex(value: string, orgId: string): string {
    return createHmac('sha256', this.indexKey).update(`${orgId}:${value}`).digest('hex');
  }
}

export function devKey(): string {
  return Buffer.alloc(32, 7).toString('base64');
}
