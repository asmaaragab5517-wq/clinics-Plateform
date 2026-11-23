import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { formatDate, formatMoney, zDate, zonedToUtc, addDays } from '@hf/shared';
import { esc, page, renderPdf } from '@hf/documents';
import type { Tx } from '@hf/db';
import { Auth, Meta, Staff } from '../common/decorators';
import { asStaff } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/principal';
import { AuditService, Tenancy } from '../common/services';
import { badRequest } from '../common/errors';
import { parse } from '../common/zod';
import { AvailabilityService } from './availability.service';

const rangeSchema = z.object({ from: zDate, to: zDate, clinicId: z.guid().optional(), doctorId: z.guid().optional() }).refine((r) => r.from <= r.to, 'from_after_to');

type Range = z.infer<typeof rangeSchema>;

/** FR-RPT-1..5: all business numbers are computed in SQL (materialised views + scoped functions), never client-side. */
@Controller('v1/reports')
export class ReportsController {
  constructor(private readonly tenancy: Tenancy, private readonly audit: AuditService, private readonly availability: AvailabilityService) {}

  @Get('dashboard')
  @Staff('report:view')
  dashboard(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const r = parse(rangeSchema, q);
    return this.tenancy.run(p, (tx) => this.compute(tx, r));
  }

  async compute(tx: Tx, r: Range) {
    const f = `($3::uuid is null or clinic_id = $3) and ($4::uuid is null or doctor_id = $4)`;
    const args = [r.from, r.to, r.clinicId ?? null, r.doctorId ?? null];
    const fromTs = zonedToUtc(r.from, '00:00');
    const toTs = zonedToUtc(addDays(r.to, 1), '00:00');
    const [byStatus, byChannel, revenue, payments, wait, topServices, ratings, sms, patients, diagnoses, refunds, outstanding] = await Promise.all([
      tx.query<{ status: string; n: number }>(`select status, sum(n)::int as n from report_appointments($1, $2) where ${f} group by status`, args),
      tx.query<{ channel: string; n: number }>(`select channel, sum(n)::int as n from report_appointments($1, $2) where ${f} group by channel`, args),
      tx.one<{ gross: number; discount: number; vat: number; net: number; total: number; bills: number }>(`select coalesce(sum(gross),0)::bigint as gross, coalesce(sum(discount),0)::bigint as discount, coalesce(sum(vat),0)::bigint as vat, coalesce(sum(net),0)::bigint as net, coalesce(sum(total),0)::bigint as total, coalesce(sum(bills),0)::int as bills from report_revenue($1, $2) where ${f}`, args),
      tx.query<{ method: string; amount: number; refunded: number; n: number }>(`select method, sum(amount)::bigint as amount, sum(refunded)::bigint as refunded, sum(n)::int as n from report_payments($1, $2) where ($3::uuid is null or clinic_id = $3) group by method`, args.slice(0, 3)),
      tx.one<{ avg_wait_min: number | null; avg_consult_min: number | null; n: number }>(`select round(sum(avg_wait_min * n) / nullif(sum(n), 0), 1) as avg_wait_min, round(sum(avg_consult_min * n) / nullif(sum(n), 0), 1) as avg_consult_min, coalesce(sum(n), 0)::int as n from report_wait($1, $2) where ${f}`, args),
      tx.query(`select r.service_id, s.name_ar, s.name_en, sum(r.net)::bigint as net, sum(r.bills)::int as bills from report_revenue($1, $2) r left join services s on s.id = r.service_id where ${f.replace(/clinic_id/g, 'r.clinic_id').replace(/doctor_id/g, 'r.doctor_id')} group by r.service_id, s.name_ar, s.name_en order by net desc limit 10`, args),
      tx.one(`select round(avg(rating)::numeric, 2) as avg, count(*)::int as count, count(*) filter (where rating <= 2)::int as low from reviews where status = 'approved' and created_at >= $1 and created_at < $2 and ($3::uuid is null or clinic_id = $3) and ($4::uuid is null or doctor_id = $4)`, [fromTs, toTs, r.clinicId ?? null, r.doctorId ?? null]),
      tx.one(`select coalesce(sum(cost),0)::int as cost, coalesce(sum(segments),0)::int as segments, count(*)::int as messages from messages where created_at >= $1 and created_at < $2 and ($3::uuid is null or clinic_id = $3)`, [fromTs, toTs, r.clinicId ?? null]),
      tx.one<{ new: number; returning: number }>(
        `with seen as (select a.patient_id, min(a.start_at) over (partition by a.patient_id) as first_visit, a.start_at from appointments a where a.status = 'completed' and ($3::uuid is null or a.clinic_id = $3) and ($4::uuid is null or a.doctor_id = $4))
         select count(distinct patient_id) filter (where first_visit >= $1)::int as new, count(distinct patient_id) filter (where first_visit < $1)::int as returning from seen where start_at >= $1 and start_at < $2`,
        [fromTs, toTs, r.clinicId ?? null, r.doctorId ?? null],
      ),
      tx.query(`select d->>'code' as code, i.title_ar, i.title_en, count(*)::int as n from encounters e cross join lateral jsonb_array_elements(e.diagnoses) d left join icd10_codes i on i.code = d->>'code' where e.status = 'signed' and e.signed_at >= $1 and e.signed_at < $2 and ($3::uuid is null or e.clinic_id = $3) and ($4::uuid is null or e.doctor_id = $4) group by 1, 2, 3 order by n desc limit 10`, [fromTs, toTs, r.clinicId ?? null, r.doctorId ?? null]),
      tx.one(`select coalesce(sum(amount),0)::int as amount, count(*)::int as n from refunds where status = 'completed' and completed_at >= $1 and completed_at < $2 and ($3::uuid is null or clinic_id = $3)`, [fromTs, toTs, r.clinicId ?? null]),
      tx.one(`select coalesce(sum(total - credited - (paid - refunded)), 0)::bigint as amount, count(*)::int as bills from bills where status in ('issued','partially_paid') and ($1::uuid is null or clinic_id = $1)`, [r.clinicId ?? null]),
    ]);
    const funnelRows = await tx.query<{ step: string; n: number }>(
      `select step, count(*)::int as n from booking_funnel where started_at >= $1 and started_at < $2 and ($3::uuid is null or clinic_id = $3) group by step`,
      [fromTs, toTs, r.clinicId ?? null],
    );
    const order = ['doctor', 'service', 'slot', 'patient', 'payment', 'done'];
    const reached = order.map((s, i) => ({ step: s, sessions: funnelRows.filter((f) => order.indexOf(f.step) >= i).reduce((a, f) => a + f.n, 0) }));
    const started = reached[0]!.sessions;
    const funnel = { started, completed: reached[5]!.sessions, completionRate: started ? Math.round((reached[5]!.sessions / started) * 1000) / 10 : 0, steps: reached };
    const statusMap = Object.fromEntries(byStatus.map((s) => [s.status, s.n]));
    const attended = (statusMap.completed ?? 0) + (statusMap.no_show ?? 0);
    const utilisation = await this.utilisation(tx, r);
    return {
      range: { from: r.from, to: r.to },
      appointments: { byStatus: statusMap, byChannel: Object.fromEntries(byChannel.map((c) => [c.channel, c.n])), total: byStatus.reduce((a, s) => a + s.n, 0) },
      noShowRate: attended ? Math.round(((statusMap.no_show ?? 0) / attended) * 1000) / 10 : 0,
      utilisation,
      wait,
      revenue,
      payments,
      refunds,
      outstanding,
      patients,
      ratings,
      topServices,
      topDiagnoses: diagnoses,
      sms,
      bookingFunnel: funnel,
    };
  }

  /** Slot utilisation %: booked capacity over offered capacity, computed with the availability engine. */
  private async utilisation(tx: Tx, r: Range) {
    const days = Math.min(31, Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86400000) + 1);
    const doctors = r.doctorId ? [r.doctorId] : (await tx.query<{ doctor_id: string }>('select distinct doctor_id from doctor_sessions where is_active and ($1::uuid is null or clinic_id = $1)', [r.clinicId ?? null])).map((d) => d.doctor_id);
    const slots = await this.availability.slots(tx, { doctorIds: doctors, clinicId: r.clinicId, from: r.from, days, channel: 'desk', leadMinutes: -366 * 24 * 60 });
    const capacity = slots.reduce((a, s) => a + s.capacity, 0);
    const booked = slots.reduce((a, s) => a + Math.min(s.booked, s.capacity), 0);
    return { capacity, booked, percent: capacity ? Math.round((booked / capacity) * 1000) / 10 : 0 };
  }

  @Get('daily-appointments')
  @Staff('report:view')
  daily(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const b = parse(z.object({ date: zDate, clinicId: z.guid().optional() }), q);
    return this.tenancy.run(p, (tx) => this.dailyRows(tx, b.date, b.clinicId));
  }

  private dailyRows(tx: Tx, date: string, clinicId?: string) {
    return tx.query(
      `select a.ref, to_char(a.start_at at time zone 'Africa/Cairo', 'HH24:MI') as time, c.name_ar as clinic, u.name_ar as doctor, p.mrn,
              p.first_name_ar || ' ' || p.family_name_ar as patient, a.status, a.channel
       from appointments a join clinics c on c.id = a.clinic_id join users u on u.id = a.doctor_id join patients p on p.id = a.patient_id
       where a.start_at >= $1 and a.start_at < $2 and ($3::uuid is null or a.clinic_id = $3) order by a.start_at`,
      [zonedToUtc(date, '00:00'), zonedToUtc(addDays(date, 1), '00:00'), clinicId ?? null],
    );
  }

  @Get('daily-closing')
  @Staff('report:view')
  closing(@Auth() p: Principal, @Query() q: Record<string, string>) {
    const b = parse(z.object({ date: zDate, clinicId: z.guid().optional() }), q);
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select sh.id, sh.clinic_id, u.name_ar as cashier, sh.status, sh.opening_float, sh.cash_in, sh.cash_out, sh.expected, sh.counted, sh.variance, sh.opened_at, sh.closed_at,
                (select coalesce(sum(amount), 0)::int from payments p where p.shift_id = sh.id and p.method = 'cash') as cash_payments,
                (select coalesce(sum(amount), 0)::int from payments p where p.clinic_id = sh.clinic_id and p.method <> 'cash' and p.created_at >= $1 and p.created_at < $2) as non_cash_payments
         from cashier_shifts sh join users u on u.id = sh.cashier_id where sh.opened_at >= $1 and sh.opened_at < $2 and ($3::uuid is null or sh.clinic_id = $3) order by sh.opened_at`,
        [zonedToUtc(b.date, '00:00'), zonedToUtc(addDays(b.date, 1), '00:00'), b.clinicId ?? null],
      ),
    );
  }

  @Get('package-liabilities')
  @Staff('report:view')
  liabilities(@Auth() p: Principal) {
    return this.tenancy.run(p, (tx) =>
      tx.query(
        `select pk.name_ar, count(*)::int as balances, sum(pb.sessions_total - pb.sessions_used)::int as sessions_remaining,
                sum(round(pk.price::numeric * (pb.sessions_total - pb.sessions_used) / pb.sessions_total))::bigint as liability
         from package_balances pb join packages pk on pk.id = pb.package_id where pb.sessions_used < pb.sessions_total and pb.expires_on >= current_date group by pk.name_ar`,
      ),
    );
  }

  /** FR-RPT-3: exports are permission-checked, audited and watermarked with user and time. */
  @Get('export')
  @Staff('report:export')
  async export(@Auth() p: Principal, @Query() q: Record<string, string>, @Meta() meta: RequestMeta, @Res() res: Response) {
    const s = asStaff(p);
    const b = parse(z.object({ report: z.enum(['daily-appointments', 'outstanding', 'revenue-by-service']), format: z.enum(['csv', 'xlsx', 'pdf']), date: zDate.optional(), from: zDate.optional(), to: zDate.optional(), clinicId: z.guid().optional() }), q);
    const rows: Record<string, unknown>[] = await this.tenancy.run(s, async (tx) => {
      let data: Record<string, unknown>[];
      if (b.report === 'daily-appointments') {
        if (!b.date) throw badRequest('date_required');
        data = await this.dailyRows(tx, b.date, b.clinicId);
      } else if (b.report === 'outstanding') {
        data = await tx.query(`select b.number, p.mrn, p.first_name_ar || ' ' || p.family_name_ar as patient, (b.total - b.credited - (b.paid - b.refunded)) as balance_piastres from bills b join patients p on p.id = b.patient_id where b.status in ('issued','partially_paid') and ($1::uuid is null or b.clinic_id = $1) order by b.issued_at`, [b.clinicId ?? null]);
      } else {
        if (!b.from || !b.to) throw badRequest('range_required');
        data = await tx.query(`select coalesce(s.name_ar, '-') as service, sum(r.net)::bigint as net_piastres, sum(r.vat)::bigint as vat_piastres, sum(r.bills)::int as bills from report_revenue($1, $2) r left join services s on s.id = r.service_id where ($3::uuid is null or r.clinic_id = $3) group by s.name_ar order by 2 desc`, [b.from, b.to, b.clinicId ?? null]);
      }
      await this.audit.record(tx, s, meta, { action: 'report.export', entity: 'report', entityId: b.report, details: { format: b.format, rows: data.length } });
      return data;
    });
    const watermark = `${s.name} · ${new Date().toISOString()}`;
    const cols = rows[0] ? Object.keys(rows[0]) : ['empty'];
    const filename = `${b.report}-${b.date ?? b.from ?? 'all'}`;
    if (b.format === 'csv') {
      const cell = (v: unknown) => {
        const t = v === null || v === undefined ? '' : String(v instanceof Date ? v.toISOString() : v);
        const safe = /^[=+\-@]/.test(t) ? `'${t}` : t; // CSV injection guard
        return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      const csv = '﻿' + [`# ${watermark}`, cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
      res.setHeader('content-type', 'text/csv; charset=utf-8').setHeader('content-disposition', `attachment; filename="${filename}.csv"`).send(csv);
      return;
    }
    if (b.format === 'xlsx') {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'HealthFlow Clinics';
      const ws = wb.addWorksheet(b.report, { views: [{ rightToLeft: true }] });
      ws.addRow([watermark]);
      ws.addRow(cols).font = { bold: true };
      for (const r of rows) ws.addRow(cols.map((c) => r[c] as never));
      res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setHeader('content-disposition', `attachment; filename="${filename}.xlsx"`).send(Buffer.from(await wb.xlsx.writeBuffer()));
      return;
    }
    const html = page({
      title: b.report, size: 'A4', watermark,
      body: `<h2>${esc(b.report)}</h2><div class="muted">${esc(watermark)}</div><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${cols.map((c) => `<td>${esc(/piastres$/.test(c) ? formatMoney(Number(r[c]), 'ar') : r[c] instanceof Date ? formatDate(r[c] as Date) : r[c])}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`,
    });
    res.setHeader('content-type', 'application/pdf').setHeader('content-disposition', `attachment; filename="${filename}.pdf"`).send(await renderPdf(html));
  }
}
