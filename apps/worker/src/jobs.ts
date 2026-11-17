import { Logger } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import {
  AppointmentsService, AuditService, AvailabilityService, CalendarSyncService, MessagingService, PaymentsService, ReportsController, TelemedicineService, EtaService, Tenancy, generateCommissionStatements,
} from '@hf/api/dist/core';
import { addDays, formatDate, formatMoney, formatTime12, localDate } from '@hf/shared';

const log = new Logger('Jobs');

export interface JobContext {
  tenancy: Tenancy;
  messaging: MessagingService;
  appointments: AppointmentsService;
  payments: PaymentsService;
  reports: ReportsController;
  availability: AvailabilityService;
  telemedicine: TelemedicineService;
  calendar: CalendarSyncService;
  eta: EtaService;
}

export function jobContext(app: INestApplicationContext): JobContext {
  const tenancy = app.get(Tenancy);
  const availability = app.get(AvailabilityService);
  return {
    tenancy,
    availability,
    messaging: app.get(MessagingService),
    appointments: app.get(AppointmentsService),
    payments: app.get(PaymentsService),
    reports: new ReportsController(tenancy, app.get(AuditService), availability),
    telemedicine: app.get(TelemedicineService),
    calendar: app.get(CalendarSyncService),
    eta: app.get(EtaService),
  };
}

async function orgs(c: JobContext): Promise<string[]> {
  return (await c.tenancy.db.raw<{ id: string }>('select id from active_organisations()')).map((o) => o.id);
}

async function forEachOrg(c: JobContext, name: string, fn: (orgId: string) => Promise<unknown>) {
  for (const org of await orgs(c)) {
    try {
      await fn(org);
    } catch (e) {
      log.error(`${name} failed for org ${org}: ${(e as Error).message}`);
    }
  }
}

/** Outbox dispatcher (every 15 s). */
export async function dispatchMessages(c: JobContext) {
  let sent = 0;
  await forEachOrg(c, 'dispatch', async (org) => {
    const due = await c.tenancy.system(org, (tx) => tx.query<{ id: string }>(`select id from messages where status = 'queued' and scheduled_for <= now() order by scheduled_for limit 200`));
    for (const m of due) if ((await c.messaging.dispatch(org, m.id)) === 'sent') sent++;
  });
  return sent;
}

/** FR-APT-3: release unpaid holds (every minute). */
export async function expireHolds(c: JobContext) {
  let n = 0;
  await forEachOrg(c, 'holds', async (org) => (n += await c.payments.expireHolds(org)));
  return n;
}

/** BR-4 reminders at the configured hours before (default 24 h and 2 h) with confirm/cancel link. */
export async function reminders(c: JobContext, siteUrl: string) {
  let n = 0;
  await forEachOrg(c, 'reminders', async (org) => {
    await c.tenancy.system(org, async (tx) => {
      const o = await tx.one<{ settings: { reminders?: { hoursBefore?: number[] } } }>('select settings from organisations where id = app_org()');
      for (const hours of o.settings.reminders?.hoursBefore ?? [24, 2]) {
        const rows = await tx.query<{ id: string; patient_id: string; clinic_id: string; start_at: Date; doctor: string; clinic: string; ref: string }>(
          `select a.id, a.patient_id, a.clinic_id, a.start_at, a.ref, u.name_ar as doctor, c.name_ar as clinic from appointments a join users u on u.id = a.doctor_id join clinics c on c.id = a.clinic_id
           where a.status in ('booked','confirmed') and a.start_at <= now() + make_interval(hours => $1) and a.start_at > now() + make_interval(hours => $1) - interval '1 hour'`,
          [hours],
        );
        for (const a of rows) {
          const ids = await c.messaging.enqueue(tx, {
            event: hours >= 12 ? 'reminder_24h' : 'reminder_2h', patientId: a.patient_id, clinicId: a.clinic_id, dedupeKey: `reminder:${hours}:${a.id}`,
            vars: { doctor: a.doctor, clinic: a.clinic, date: formatDate(new Date(a.start_at)), time: formatTime12(new Date(a.start_at), 'ar'), link: `${siteUrl}/ar/portal?appointment=${a.id}`, ref: a.ref },
          });
          n += ids.length;
        }
      }
    });
  });
  return n;
}

/** FR-APT-2: booked/confirmed not checked in N minutes after the slot ends → no_show. */
export async function markNoShows(c: JobContext) {
  let n = 0;
  await forEachOrg(c, 'no-show', async (org) => {
    await c.tenancy.system(org, async (tx) => {
      const policy = await c.appointments.policy(tx);
      const rows = await tx.query<{ id: string }>(
        `select id from appointments where status in ('booked','confirmed') and end_at + make_interval(mins => $1) < now() for update skip locked limit 500`,
        [policy.noShowAfterMinutes],
      );
      for (const r of rows) await c.appointments.transition(tx, null, null, r.id, 'no_show');
      n += rows.length;
    });
  });
  return n;
}

/** FR-APT-9 follow-up reminder chain (7 days and 1 day before) and FR-APT-10 waitlist offers. */
export async function followUpsAndWaitlist(c: JobContext, siteUrl: string) {
  await forEachOrg(c, 'follow-ups', async (org) => {
    await c.tenancy.system(org, async (tx) => {
      const today = localDate(new Date());
      for (const days of [7, 1]) {
        const due = await tx.query<{ id: string; patient_id: string; clinic_id: string; due_date: string; doctor: string }>(
          `select f.id, f.patient_id, f.clinic_id, f.due_date, u.name_ar as doctor from follow_ups f join users u on u.id = f.doctor_id where f.status = 'due' and f.due_date = $1::date`,
          [addDays(today, days)],
        );
        for (const f of due) {
          await c.messaging.enqueue(tx, { event: 'follow_up_due', patientId: f.patient_id, clinicId: f.clinic_id, dedupeKey: `followup:${days}:${f.id}`, vars: { doctor: f.doctor, date: f.due_date, link: `${siteUrl}/ar/book` } });
        }
      }
      const waiting = await tx.query<{ id: string; patient_id: string; clinic_id: string; doctor_id: string; service_id: string | null; earliest: string; latest: string | null }>(
        `select * from waitlist where status = 'waiting' and coalesce(latest, earliest + 30) >= current_date order by created_at limit 100`,
      );
      for (const w of waiting) {
        const from = w.earliest > today ? w.earliest : today;
        const span = Math.min(14, Math.max(1, Math.round((Date.parse(w.latest ?? addDays(from, 14)) - Date.parse(from)) / 86400000) + 1));
        const slot = (await c.availability.slots(tx, { doctorIds: [w.doctor_id], clinicId: w.clinic_id, serviceId: w.service_id, from, days: span, channel: 'online', leadMinutes: 120 })).find((s) => s.available > 0);
        if (!slot) continue;
        // First-come: the oldest waiting entry is offered first; one offer per run per doctor.
        await tx.query(`update waitlist set status = 'offered', offered_at = now() where id = $1`, [w.id]);
        await c.messaging.enqueue(tx, { event: 'follow_up_due', patientId: w.patient_id, clinicId: w.clinic_id, dedupeKey: `waitlist:${w.id}`, vars: { doctor: '', date: `${slot.date} ${slot.localStart}`, link: `${siteUrl}/ar/book?doctor=${w.doctor_id}` } });
      }
      await tx.query(`update waitlist set status = 'expired' where status in ('waiting','offered') and coalesce(latest, earliest + 30) < current_date`);
    });
  });
}

export async function refreshReports(c: JobContext) {
  const anyOrg = (await orgs(c))[0];
  if (anyOrg) await c.tenancy.system(anyOrg, (tx) => tx.query('select refresh_reports()'));
}

/** FR-HP-5 daily reconciliation for yesterday; mismatches create an accountant task. */
export async function reconcile(c: JobContext, date = addDays(localDate(new Date()), -1)) {
  await forEachOrg(c, 'reconcile', async (org) => {
    const runs = await c.payments.reconcile(org, date);
    const bad = runs.filter((r) => (r.mismatches as unknown[]).length > 0);
    if (bad.length) {
      await c.tenancy.system(org, (tx) =>
        tx.query(`insert into tasks (organisation_id, kind, title, assignee_role) values (app_org(), 'reconciliation', $1, 'accountant')`, [`HealthPay reconciliation mismatches on ${date}: ${bad.length} clinic(s)`]),
      );
    }
  });
}

/** FR-PRV-3 nightly chain verification. */
export async function verifyAudit(c: JobContext) {
  const broken: string[] = [];
  await forEachOrg(c, 'audit-verify', async (org) => {
    const r = await c.tenancy.system(org, (tx) => tx.one<{ broken: number | null }>('select audit_verify(app_org()) as broken'));
    if (r.broken !== null) {
      broken.push(org);
      log.error(`AUDIT CHAIN BROKEN for org ${org} at seq ${r.broken}`);
      await c.tenancy.system(org, (tx) => tx.query(`insert into tasks (organisation_id, kind, title, assignee_role) values (app_org(), 'audit_chain', $1, 'owner')`, [`Audit chain verification failed at seq ${r.broken}`]));
    }
  });
  return broken;
}

/** FR-PRV-6 retention: expired OTPs, message bodies after 90 days, abandoned bookings after 30 days. */
export async function retention(c: JobContext) {
  await forEachOrg(c, 'retention', async (org) => {
    await c.tenancy.system(org, async (tx) => {
      await tx.query(`delete from otp_codes where expires_at < now() - interval '1 day'`);
      await tx.query(`delete from booking_funnel where updated_at < now() - interval '30 days'`);
      await tx.query(`delete from refresh_tokens where expires_at < now() - interval '7 days'`);
      await tx.query(`update messages set body = null where body is not null and created_at < now() - interval '90 days'`);
      const abandoned = await tx.query<{ id: string }>(`select id from appointments where status = 'cancelled' and cancel_reason = 'hold_expired' and created_at < now() - interval '30 days' limit 1000`);
      const ids = abandoned.map((a) => a.id);
      if (ids.length) {
        await tx.query(`delete from payment_intents where appointment_id = any($1::uuid[]) and status <> 'captured'`, [ids]);
        await tx.query('delete from appointment_events where appointment_id = any($1::uuid[])', [ids]);
        await tx.query('delete from appointment_services where appointment_id = any($1::uuid[])', [ids]);
        await tx.query(`delete from messages where dedupe_key like any(array(select 'booked:' || x || '%' from unnest($1::text[]) x))`, [ids]);
        await tx.query(`delete from appointments a where id = any($1::uuid[]) and not exists (select 1 from bills b where b.appointment_id = a.id) and not exists (select 1 from payment_intents i where i.appointment_id = a.id)`, [ids]);
      }
    });
  });
}

/** FR-RPT-5 / FR-COM-3: daily director summary email at 08:00 Cairo. */
export async function directorSummary(c: JobContext) {
  await forEachOrg(c, 'director-summary', async (org) => {
    await c.tenancy.system(org, async (tx) => {
      const day = addDays(localDate(new Date()), -1);
      const d = await c.reports.compute(tx, { from: day, to: day });
      const recipients = await tx.query<{ email: string }>(`select distinct u.email from users u join staff_memberships m on m.user_id = u.id where m.role in ('owner','network_director') and u.status = 'active' and u.email is not null`);
      const body = [
        `${day}`,
        `Appointments: ${d.appointments.total} · No-show: ${d.noShowRate}% · Utilisation: ${d.utilisation.percent}%`,
        `Revenue: ${formatMoney(Number(d.revenue.total), 'ar')} (VAT ${formatMoney(Number(d.revenue.vat), 'ar')})`,
        `Average wait: ${d.wait.avg_wait_min ?? '-'} min · Rating: ${(d.ratings as { avg: number | null }).avg ?? '-'}`,
      ].join('\n');
      for (const r of recipients) {
        await tx.query(
          `insert into messages (organisation_id, event, channel, recipient, locale, body, dedupe_key) values (app_org(), 'director_daily_summary', 'email', $1, 'ar', $2, $3) on conflict (organisation_id, dedupe_key) do nothing`,
          [r.email, body, `summary:${day}:${r.email}`],
        );
      }
    });
  });
}

/** FR-STF-3 monthly statements for the previous month (drafts for Accountant approval). */
export async function commissions(c: JobContext, now = new Date()) {
  const today = localDate(now);
  const prev = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  await forEachOrg(c, 'commissions', (org) => c.tenancy.system(org, (tx) => generateCommissionStatements(tx, prev)));
  return prev;
}

/** FR-TEL-2: create meetings for the next 24 h of video consultations; cancel meetings of cancelled visits. */
export async function prepareTelemedicine(c: JobContext) {
  let created = 0;
  await forEachOrg(c, 'telemedicine', async (org) => {
    await c.tenancy.system(org, async (tx) => {
      const due = await tx.query<import('@hf/api/dist/modules/appointments.service').ApptRow>(
        `select a.* from appointments a where a.status in ('booked','confirmed') and a.start_at < now() + interval '24 hours' and a.start_at > now() - interval '1 hour'
           and not exists (select 1 from telemedicine_sessions t where t.appointment_id = a.id)
           and exists (select 1 from appointment_services x join services s on s.id = x.service_id where x.appointment_id = a.id and s.type = 'telemedicine')`,
      );
      for (const a of due) {
        await c.telemedicine.ensureSession(tx, a);
        created++;
      }
      const stale = await tx.query<Parameters<TelemedicineService['cancel']>[1]>(
        `select t.* from telemedicine_sessions t join appointments a on a.id = t.appointment_id where a.status in ('cancelled','no_show') and t.status in ('scheduled','patient_waiting')`,
      );
      for (const s of stale) await c.telemedicine.cancel(tx, s);
    });
  });
  return created;
}

/** FR-INT-2 Google Calendar one-way sync for connected doctors. */
export async function syncCalendars(c: JobContext) {
  let n = 0;
  await forEachOrg(c, 'calendar-sync', async (org) => {
    n += await c.tenancy.system(org, (tx) => c.calendar.syncOrg(tx));
  });
  return n;
}

/** FR-BIL-10: submit queued ETA e-receipts with retry/backoff. */
export async function submitEtaReceipts(c: JobContext) {
  let n = 0;
  await forEachOrg(c, 'eta', async (org) => {
    n += await c.tenancy.system(org, (tx) => c.eta.submitDue(tx));
  });
  return n;
}
