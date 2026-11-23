import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { egpToPiastres, patientSchema, serviceSchema, zDate } from '@hf/shared';
import type { Tx } from '@hf/db';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta, StaffPrincipal } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { DomainError, badRequest, notFound } from '../common/errors';
import { parse, uuid } from '../common/zod';
import { PatientsService } from './patients.service';

type Entity = 'patients' | 'services' | 'prices';

/** Column templates (FR-IMP-2). Images by URL are never fetched (FR-IMP-3, SSRF prevention). */
export const IMPORT_TEMPLATES: Record<Entity, string[]> = {
  patients: ['first_name_ar', 'father_name_ar', 'grandfather_name_ar', 'family_name_ar', 'name_en', 'national_id', 'date_of_birth', 'gender', 'phone', 'governorate', 'city', 'address'],
  services: ['code', 'name_ar', 'name_en', 'duration_minutes', 'type', 'vat'],
  prices: ['clinic_slug', 'service_code', 'price_egp', 'effective_from'],
};

const rowSchemas: Record<Entity, ZodTypeAny> = {
  patients: z
    .record(z.string(), z.string())
    // The pipe re-validates everything, so the mapped row is passed on untyped.
    .transform((r): unknown => ({
      nameAr: { first: r.first_name_ar ?? '', father: r.father_name_ar ?? '', grandfather: r.grandfather_name_ar ?? '', family: r.family_name_ar ?? '' },
      nameEn: r.name_en || undefined,
      nationalId: r.national_id || undefined,
      dateOfBirth: r.date_of_birth,
      gender: r.gender === 'ذكر' ? 'male' : r.gender === 'أنثى' ? 'female' : r.gender,
      phones: [{ number: r.phone ?? '', primary: true }],
      governorate: r.governorate || undefined,
      city: r.city || undefined,
      address: r.address || undefined,
    }))
    .pipe(patientSchema),
  services: z
    .record(z.string(), z.string())
    .transform((r): unknown => ({ code: r.code, name: { ar: r.name_ar, en: r.name_en ?? '' }, durationMinutes: Number(r.duration_minutes), type: r.type, vat: r.vat }))
    .pipe(serviceSchema),
  prices: z
    .record(z.string(), z.string())
    .transform((r, ctx) => {
      try {
        return { clinicSlug: r.clinic_slug, serviceCode: r.service_code, price: egpToPiastres(r.price_egp ?? ''), effectiveFrom: r.effective_from };
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_price' });
        return z.NEVER;
      }
    })
    .pipe(z.object({ clinicSlug: z.string().min(1), serviceCode: z.string().min(1), price: z.number().int().min(0), effectiveFrom: zDate })),
};

/** RFC 4180 CSV parser (quoted fields, embedded commas/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

async function readTable(file: { buffer: Buffer; originalname?: string }): Promise<string[][]> {
  const isXlsx = file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
  if (!isXlsx) return parseCsv(file.buffer.toString('utf8'));
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer as never);
  const ws = wb.worksheets[0];
  const out: string[][] = [];
  ws?.eachRow((r) => out.push((r.values as unknown[]).slice(1).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? '' : String(typeof v === 'object' && 'text' in (v as object) ? (v as { text: string }).text : v)))));
  return out;
}

@Controller('v1/imports')
export class ImportsController {
  constructor(private readonly tenancy: Tenancy, private readonly audit: AuditService, private readonly patients: PatientsService) {}

  @Get('templates/:entity')
  @Staff('import:view')
  template(@Param('entity') entity: string, @Res() res: Response) {
    const e = parse(z.enum(['patients', 'services', 'prices']), entity);
    res.setHeader('content-type', 'text/csv; charset=utf-8').setHeader('content-disposition', `attachment; filename="${e}-template.csv"`).send('﻿' + IMPORT_TEMPLATES[e].join(',') + '\r\n');
  }

  /** Upload → column mapping → validation preview (dry run) with errors per row. */
  @Post()
  @Staff('import:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@Auth() p: Principal, @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined, @Body() body: { entity?: string; mapping?: string }, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    const entity = parse(z.enum(['patients', 'services', 'prices']), body?.entity);
    if (!file) throw badRequest('file_required');
    const mapping = body?.mapping ? parse(z.record(z.string(), z.string()), JSON.parse(body.mapping)) : {};
    const table = await readTable(file);
    if (table.length < 2) throw badRequest('empty_file');
    if (table.length > 5001) throw badRequest('too_many_rows', 5000);
    const header = table[0]!.map((h) => h.trim());
    const fields = IMPORT_TEMPLATES[entity];
    const colOf = (f: string) => header.indexOf(mapping[f] ?? f);
    const missing = fields.filter((f) => colOf(f) < 0 && !['grandfather_name_ar', 'name_en', 'national_id', 'governorate', 'city', 'address', 'father_name_ar', 'family_name_ar'].includes(f));
    if (missing.length) throw badRequest('missing_columns', missing);
    return this.tenancy.run(s, async (tx) => {
      const batch = await tx.one<{ id: string }>(`insert into import_batches (organisation_id, entity, row_count, created_by) values (app_org(), $1, $2, $3) returning id`, [entity, table.length - 1, s.userId]);
      let errors = 0;
      const seen = new Set<string>();
      for (const [i, cells] of table.slice(1).entries()) {
        const raw = Object.fromEntries(fields.map((f) => [f, (cells[colOf(f)] ?? '').trim()]));
        const r = rowSchemas[entity].safeParse(raw);
        const rowErrors: string[] = r.success ? [] : r.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`);
        if (r.success) rowErrors.push(...(await this.crossCheck(tx, s, entity, r.data as Record<string, unknown>, seen)));
        if (rowErrors.length) errors++;
        await tx.query('insert into import_rows (organisation_id, batch_id, row_number, data, errors) values (app_org(), $1,$2,$3,$4)', [batch.id, i + 2, JSON.stringify(r.success ? r.data : raw), JSON.stringify(rowErrors)]);
      }
      const report = { rows: table.length - 1, valid: table.length - 1 - errors, errors };
      await tx.query(`update import_batches set status = 'validated', error_count = $2, dry_run_report = $3 where id = $1`, [batch.id, errors, JSON.stringify(report)]);
      await this.audit.record(tx, s, meta, { action: 'import.validate', entity: 'import_batch', entityId: batch.id, details: { entity, ...report } });
      return { id: batch.id, entity, ...report };
    });
  }

  private async crossCheck(tx: Tx, s: StaffPrincipal, entity: Entity, d: Record<string, unknown>, seen: Set<string>): Promise<string[]> {
    const errs: string[] = [];
    if (entity === 'patients') {
      const pd = d as z.infer<typeof patientSchema>;
      const key = pd.nationalId ?? `${pd.phones[0]?.number}|${pd.dateOfBirth}|${pd.nameAr.first}`;
      if (seen.has(key)) errs.push('duplicate_in_file');
      seen.add(key);
      const dups = await this.patients.findDuplicates(tx, s.orgId, pd);
      if (dups.some((x) => x.reason === 'national_id')) errs.push('national_id_exists');
    } else if (entity === 'services') {
      if (await tx.maybeOne('select 1 from services where code = $1', [d.code])) errs.push('code_exists');
    } else {
      if (!(await tx.maybeOne('select 1 from clinics where slug = $1', [d.clinicSlug]))) errs.push('unknown_clinic');
      if (!(await tx.maybeOne('select 1 from services where code = $1', [d.serviceCode]))) errs.push('unknown_service');
    }
    return errs;
  }

  @Get()
  @Staff('import:view')
  list(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) => tx.query('select id, entity, status, row_count, error_count, committed_at, created_at from import_batches order by created_at desc limit 100'));
  }

  @Get(':id')
  @Staff('import:view')
  async get(@Auth() p: Principal, @Param('id') id: string) {
    return this.tenancy.run(p, async (tx) => {
      const b = await tx.maybeOne('select * from import_batches where id = $1', [uuid(id)]);
      if (!b) throw notFound('import');
      const rows = await tx.query(`select row_number, errors, created_entity_id from import_rows where batch_id = $1 and (jsonb_array_length(errors) > 0 or created_entity_id is not null) order by row_number limit 1000`, [id]);
      return { ...b, rows };
    });
  }

  /** Commit valid rows (rows with errors are skipped and reported). */
  @Post(':id/commit')
  @Staff('import:approve')
  @HttpCode(200)
  commit(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const b = await tx.maybeOne<{ id: string; entity: Entity; status: string }>('select * from import_batches where id = $1 for update', [uuid(id)]);
      if (!b) throw notFound('import');
      if (b.status !== 'validated') throw new DomainError('import_not_validated', HttpStatus.CONFLICT);
      const rows = await tx.query<{ id: string; data: Record<string, unknown> }>(`select id, data from import_rows where batch_id = $1 and jsonb_array_length(errors) = 0 order by row_number`, [id]);
      let created = 0;
      for (const r of rows) {
        const entityId = await this.createEntity(tx, s, b.entity, r.data);
        await tx.query('update import_rows set created_entity_id = $2 where id = $1', [r.id, entityId]);
        created++;
      }
      await tx.query(`update import_batches set status = 'committed', committed_at = now() where id = $1`, [id]);
      await this.audit.record(tx, s, meta, { action: 'import.commit', entity: 'import_batch', entityId: id, details: { created } });
      return { created };
    });
  }

  private async createEntity(tx: Tx, s: StaffPrincipal, entity: Entity, d: Record<string, unknown>): Promise<string> {
    if (entity === 'patients') return (await this.patients.create(tx, s, patientSchema.parse(d), { force: true, allowMinorWithoutGuardian: true })).id;
    if (entity === 'services') {
      const x = serviceSchema.parse(d);
      return (await tx.one<{ id: string }>('insert into services (organisation_id, code, name_ar, name_en, duration_minutes, type, vat) values (app_org(), $1,$2,$3,$4,$5,$6) returning id', [x.code, x.name.ar, x.name.en, x.durationMinutes, x.type, x.vat])).id;
    }
    const x = d as { clinicSlug: string; serviceCode: string; price: number; effectiveFrom: string };
    return (
      await tx.one<{ id: string }>(
        `insert into price_list_items (organisation_id, clinic_id, service_id, price, effective_from) select app_org(), c.id, s.id, $3, $4 from clinics c, services s where c.slug = $1 and s.code = $2 returning id`,
        [x.clinicSlug, x.serviceCode, x.price, x.effectiveFrom],
      )
    ).id;
  }

  /** Roll back a whole batch within 24 hours; refuses when imported records have since been used. */
  @Post(':id/rollback')
  @Staff('import:approve')
  @HttpCode(200)
  rollback(@Auth() p: Principal, @Param('id') id: string, @Meta() meta: RequestMeta) {
    const s = asStaff(p);
    return this.tenancy.run(s, async (tx) => {
      const b = await tx.maybeOne<{ entity: Entity; status: string; committed_at: Date }>('select * from import_batches where id = $1 for update', [uuid(id)]);
      if (!b) throw notFound('import');
      if (b.status !== 'committed') throw new DomainError('import_not_committed', HttpStatus.CONFLICT);
      if (Date.now() - new Date(b.committed_at).getTime() > 24 * 3600_000) throw new DomainError('rollback_window_expired', HttpStatus.CONFLICT);
      const ids = (await tx.query<{ created_entity_id: string }>('select created_entity_id from import_rows where batch_id = $1 and created_entity_id is not null', [id])).map((r) => r.created_entity_id);
      if (b.entity === 'patients') {
        const used = await tx.maybeOne('select 1 from appointments where patient_id = any($1::uuid[]) union all select 1 from bills where patient_id = any($1::uuid[]) limit 1', [ids]);
        if (used) throw new DomainError('imported_records_in_use', HttpStatus.CONFLICT);
        await tx.query('delete from patient_contacts where patient_id = any($1::uuid[])', [ids]);
        await tx.query('delete from consents where patient_id = any($1::uuid[])', [ids]);
        await tx.query('delete from patients where id = any($1::uuid[])', [ids]);
      } else if (b.entity === 'services') {
        await tx.query('delete from services where id = any($1::uuid[]) and not exists (select 1 from price_list_items where service_id = services.id)', [ids]);
      } else {
        await tx.query('delete from price_list_items where id = any($1::uuid[])', [ids]);
      }
      await tx.query(`update import_batches set status = 'rolled_back' where id = $1`, [id]);
      await this.audit.record(tx, s, meta, { action: 'import.rollback', entity: 'import_batch', entityId: id, details: { count: ids.length } });
      return { rolledBack: ids.length };
    });
  }
}
