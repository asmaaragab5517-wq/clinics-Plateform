import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SecretBox, Tx } from '@hf/db';
import { buildEtaReceipt, etaQrUrl, etaSerialize } from '@hf/shared';
import { Auth, Meta, Staff } from '../common/decorators';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, BOX, Tenancy } from '../common/services';
import { badRequest, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { ETA, type EtaClient, type EtaCredentials } from '../integrations/eta';

const MAX_ATTEMPTS = 8;

@Injectable()
export class EtaService {
  constructor(@Inject(BOX) private readonly box: SecretBox, @Inject(ETA) private readonly client: EtaClient) {}

  credentials(le: { id: string; eta_config_enc: Buffer | null }): EtaCredentials | null {
    return le.eta_config_enc ? JSON.parse(this.box.decrypt(le.eta_config_enc, `eta:${le.id}`)) : null;
  }

  /** Queue a B2C e-receipt when a bill becomes fully paid (only for legal entities with ETA configured). */
  async enqueue(tx: Tx, billId: string) {
    const b = await tx.maybeOne<{ id: string; clinic_id: string; legal_entity_id: string | null; number: string; patient_id: string; subtotal: number; discount: number; vat: number; total: number; credited: number }>('select * from bills where id = $1', [billId]);
    if (!b?.legal_entity_id) return null;
    const le = await tx.one<{ id: string; eta_config_enc: Buffer | null }>('select id, eta_config_enc from legal_entities where id = $1', [b.legal_entity_id]);
    const creds = this.credentials(le);
    if (!creds) return null;
    const exists = await tx.maybeOne('select 1 from eta_receipts where bill_id = $1', [billId]);
    if (exists) return null;
    // Receipts are chained per POS (clinic): serialise so previousUUID is never shared by two receipts.
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`eta:${b.clinic_id}`]);
    const prev = await tx.maybeOne<{ uuid: string }>(`select uuid from eta_receipts where clinic_id = $1 and uuid is not null order by created_at desc limit 1`, [b.clinic_id]);
    const lines = await tx.query<{ description: string; qty: number; unit_price: number; gross: number; discount: number; net: number; vat: number; total: number; code: string | null }>(
      `select l.description, l.qty, l.unit_price, l.gross, l.discount, l.net, l.vat, l.total, coalesce(s.code, p.id::text, 'ITEM') as code
       from bill_lines l left join services s on s.id = l.service_id left join packages p on p.id = l.package_id where l.bill_id = $1 order by l.position`,
      [billId],
    );
    const pays = await tx.query<{ method: string }>(`select method from payments where bill_id = $1 and status = 'captured'`, [billId]);
    const issuedAt = new Date();
    const doc = buildEtaReceipt({
      receiptNumber: b.number, issuedAt, previousUuid: prev?.uuid ?? null,
      seller: { rin: creds.rin, companyTradeName: creds.companyTradeName, branchCode: creds.branchCode, activityCode: creds.activityCode, ...creds.address },
      buyer: { type: 'P' },
      items: lines.map((l) => ({ internalCode: l.code ?? 'ITEM', description: l.description, itemType: 'EGS', itemCode: `EG-${creds.rin}-${l.code}`, unitType: 'EA', quantity: l.qty, unitPrice: l.unit_price, netSale: l.net, totalSale: l.gross, total: l.total, discount: l.discount, vat: l.vat })),
      totals: { totalSales: b.subtotal, totalDiscount: b.discount, netAmount: b.subtotal - b.discount, totalAmount: b.total, vat: b.vat },
      paymentMethod: pays.every((p) => p.method === 'cash') ? 'C' : pays.some((p) => p.method === 'card_at_clinic' || p.method === 'healthpay') ? 'V' : 'O',
    });
    doc.header.uuid = createHash('sha256').update(etaSerialize(doc)).digest('hex');
    return tx.one(
      `insert into eta_receipts (organisation_id, legal_entity_id, clinic_id, bill_id, receipt_number, uuid, previous_uuid, issued_at, payload) values (app_org(), $1,$2,$3,$4,$5,$6,$7,$8) returning id, uuid`,
      [b.legal_entity_id, b.clinic_id, billId, b.number, doc.header.uuid, prev?.uuid ?? null, issuedAt, JSON.stringify(doc)],
    );
  }

  /** Submit due receipts with retry and exponential backoff (worker, every minute). */
  async submitDue(tx: Tx) {
    const due = await tx.query<{ id: string; legal_entity_id: string; payload: unknown; attempts: number; receipt_number: string }>(
      `select id, legal_entity_id, payload, attempts, receipt_number from eta_receipts where status in ('queued','failed') and attempts < $1 and next_attempt_at <= now() order by created_at limit 100 for update skip locked`,
      [MAX_ATTEMPTS],
    );
    const byEntity = new Map<string, typeof due>();
    for (const r of due) byEntity.set(r.legal_entity_id, [...(byEntity.get(r.legal_entity_id) ?? []), r]);
    let accepted = 0;
    for (const [leId, rows] of byEntity) {
      const le = await tx.one<{ id: string; eta_config_enc: Buffer | null; eta_mode: 'preprod' | 'prod' }>('select id, eta_config_enc, eta_mode from legal_entities where id = $1', [leId]);
      const creds = this.credentials(le);
      if (!creds) continue;
      try {
        const res = await this.client.submit(creds, le.eta_mode, rows.map((r) => r.payload));
        for (const r of rows) {
          const ok = res.accepted.find((a) => a.receiptNumber === r.receipt_number);
          const bad = res.rejected.find((a) => a.receiptNumber === r.receipt_number);
          if (ok) accepted++;
          await tx.query(
            `update eta_receipts set status = $2, submission_id = $3, errors = $4, attempts = attempts + 1, submitted_at = now() where id = $1`,
            [r.id, ok ? 'valid' : bad ? 'invalid' : 'submitted', res.submissionId, bad ? JSON.stringify(bad.error) : null],
          );
        }
      } catch (e) {
        for (const r of rows) {
          await tx.query(
            `update eta_receipts set status = 'failed', attempts = attempts + 1, errors = $2, next_attempt_at = now() + (interval '1 minute' * power(2, attempts)) where id = $1`,
            [r.id, JSON.stringify({ message: (e as Error).message })],
          );
        }
      }
    }
    return accepted;
  }

  qrFor(r: { uuid: string; issued_at: Date; total: number; rin: string; mode: string }) {
    return etaQrUrl(r.uuid, new Date(r.issued_at), r.total, r.rin, r.mode === 'prod');
  }
}

@Controller('v1')
export class EtaController {
  constructor(private readonly tenancy: Tenancy, private readonly audit: AuditService, private readonly eta: EtaService, @Inject(BOX) private readonly box: SecretBox) {}

  /** ETA credentials per legal entity, encrypted and never returned (SEC-3). */
  @Put('legal-entities/:id/eta')
  @Staff('settings:edit')
  configure(@Auth() p: Principal, @Param('id') id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(
      z.object({
        mode: z.enum(['preprod', 'prod']),
        clientId: z.string().min(4), clientSecret: z.string().min(4), posSerial: z.string().min(1), posOsVersion: z.string().default('linux'), presharedKey: z.string().default(''),
        rin: z.string().regex(/^\d{9}$/), branchCode: z.string().default('0'), activityCode: z.string().regex(/^\d{4}$/), companyTradeName: z.string().min(2),
        address: z.object({ governate: z.string(), regionCity: z.string(), street: z.string(), buildingNumber: z.string() }),
      }),
      body,
    );
    return this.tenancy.run(p, async (tx) => {
      const { mode, ...creds } = b;
      const r = await tx.maybeOne('update legal_entities set eta_config_enc = $2, eta_mode = $3 where id = $1 returning id', [uuid(id), this.box.encrypt(JSON.stringify(creds), `eta:${id}`), mode]);
      if (!r) throw notFound('legal_entity');
      await this.audit.record(tx, p, meta, { action: 'eta.configure', entity: 'legal_entity', entityId: id, details: { mode } });
      return { ok: true, mode };
    });
  }

  /** Submission status dashboard (FR-BIL-10). */
  @Get('eta/receipts')
  @Staff('bill:view')
  list(@Auth() p: Principal, @Query('status') status?: string) {
    return this.tenancy.run(p, async (tx) => ({
      summary: await tx.query(`select status, count(*)::int as n from eta_receipts group by status`),
      receipts: await tx.query(
        `select id, clinic_id, bill_id, receipt_number, uuid, status, attempts, errors, submitted_at, created_at from eta_receipts where ($1::text is null or status = $1) order by created_at desc limit 200`,
        [status ?? null],
      ),
    }));
  }

  @Post('eta/receipts/:id/retry')
  @Staff('bill:approve')
  @HttpCode(200)
  retry(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    return this.tenancy.run(p, async (tx) => {
      const r = await tx.maybeOne(`update eta_receipts set status = 'queued', attempts = 0, next_attempt_at = now() where id = $1 and status in ('failed','invalid') returning id`, [uuid(id)]);
      if (!r) throw badRequest('not_retryable');
      await this.audit.record(tx, p, meta, { action: 'eta.retry', entity: 'eta_receipt', entityId: id });
      return { ok: true };
    });
  }
}
